#!/usr/bin/env node

import { randomBytes, createHash } from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const JOB_VERSION = 1;
const DEFAULT_HEARTBEAT_MS = 30_000;
const DEFAULT_WAIT_TIMEOUT_MS = 240_000;
const DEFAULT_POLL_MS = 1_000;
const STARTUP_GRACE_MS = 60_000;
const MAX_TAIL_BYTES = 256 * 1024;
const RUNNER = fileURLToPath(new URL("./codex-jsonl-runner.mjs", import.meta.url));
const TERMINAL_STATUSES = new Set(["completed", "failed", "cancelled", "stale"]);

function usage() {
  return [
    "Usage:",
    "  node codex-job.mjs start --prompt FILE [--workspace DIR] [--title TEXT]",
    "    [--heartbeat-ms N] [--json] -- codex exec ... --json -",
    "  node codex-job.mjs status [JOB_ID] [--workspace DIR] [--all] [--wait]",
    "    [--timeout-ms N] [--poll-ms N] [--json]",
    "  node codex-job.mjs result [JOB_ID] [--workspace DIR] [--json]",
    "  node codex-job.mjs cancel [JOB_ID] [--workspace DIR] [--json]",
  ].join("\n");
}

function parseOptions(argv, { values = [], booleans = [] } = {}) {
  const valueSet = new Set(values);
  const booleanSet = new Set(booleans);
  const options = {};
  const positionals = [];

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith("--")) {
      positionals.push(argument);
      continue;
    }
    const equals = argument.indexOf("=");
    const name = equals >= 0 ? argument.slice(2, equals) : argument.slice(2);
    if (booleanSet.has(name)) {
      if (equals >= 0) throw new Error(`--${name} does not accept a value`);
      options[name] = true;
      continue;
    }
    if (!valueSet.has(name)) throw new Error(`unknown option: --${name}`);
    const value = equals >= 0 ? argument.slice(equals + 1) : argv[++index];
    if (value == null || value === "") throw new Error(`--${name} requires a value`);
    options[name] = value;
  }
  return { options, positionals };
}

function normalizeForwardedArgs(argv) {
  if (argv.length !== 1) return argv;
  const raw = argv[0].trim();
  if (!raw) return [];
  if (!/\s/.test(raw)) return [raw];

  const result = [];
  let token = "";
  let quote = null;
  for (let index = 0; index < raw.length; index += 1) {
    const character = raw[index];
    if (quote) {
      if (character === quote) {
        quote = null;
      } else if (character === "\\" && raw[index + 1] === quote) {
        token += raw[++index];
      } else {
        token += character;
      }
      continue;
    }
    if (character === "\"" || character === "'") {
      quote = character;
    } else if (/\s/.test(character)) {
      if (token) {
        result.push(token);
        token = "";
      }
    } else {
      token += character;
    }
  }
  if (quote) throw new Error("unterminated quote in command arguments");
  if (token) result.push(token);
  return result;
}

function numberOption(value, fallback, name, { min = 0 } = {}) {
  if (value == null) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min) throw new Error(`--${name} must be a number >= ${min}`);
  return parsed;
}

function canonicalWorkspace(value = process.cwd()) {
  const resolved = path.resolve(value);
  try {
    return fs.realpathSync.native(resolved);
  } catch {
    return resolved;
  }
}

function resolveJobRoot(options = {}, env = process.env) {
  if (options["state-root"]) return path.resolve(options["state-root"]);
  if (env.LASK_CODEX_JOB_ROOT) return path.resolve(env.LASK_CODEX_JOB_ROOT);
  // Not CLAUDE_PLUGIN_DATA: the Bash tool that starts a job never carries lask's own value,
  // only whatever another plugin exported into the session, so start and status disagreed.
  return path.join(os.tmpdir(), "lask-codex-jobs");
}

function workspaceScopeDir(workspace, options = {}, env = process.env) {
  const slug = (path.basename(workspace) || "workspace")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "workspace";
  const identity = process.platform === "win32" ? workspace.toLowerCase() : workspace;
  const hash = createHash("sha256").update(identity).digest("hex").slice(0, 16);
  return path.join(resolveJobRoot(options, env), `${slug}-${hash}`);
}

function createJobId(now = Date.now()) {
  return `codex-${now.toString(36)}-${randomBytes(4).toString("hex")}`;
}

function fsyncParent(file) {
  if (process.platform === "win32") return;
  const descriptor = fs.openSync(path.dirname(path.resolve(file)), "r");
  try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
}

function writeJsonExclusive(file, value) {
  const descriptor = fs.openSync(file, "wx");
  try {
    fs.writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  fsyncParent(file);
}

function writeJsonAtomicIfAbsent(file, value) {
  const temporary = `${file}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  writeJsonExclusive(temporary, value);
  try {
    try {
      fs.linkSync(temporary, file);
      fsyncParent(file);
      return true;
    } catch (error) {
      if (error.code === "EEXIST") return false;
      if (!new Set(["EPERM", "ENOTSUP", "EXDEV"]).has(error.code)) throw error;
      if (fs.existsSync(file)) return false;
      try {
        fs.renameSync(temporary, file);
        fsyncParent(file);
        return true;
      } catch (renameError) {
        if (fs.existsSync(file)) return false;
        throw renameError;
      }
    }
  } finally {
    try { fs.unlinkSync(temporary); } catch { /* renamed or already removed */ }
  }
}

function hasChildOption(command, names) {
  return command.some((argument) => names.some((name) => argument === name || argument.startsWith(`${name}=`)));
}

function buildManagedCommand(command, finalFile) {
  if (command.length === 0) throw new Error("missing child command after --");
  if (!command.includes("--json")) throw new Error("child command must include --json");
  if (hasChildOption(command, ["--output-last-message", "-o"]))
    throw new Error("codex-job owns --output-last-message; remove it from the child command");
  if (command.at(-1) !== "-")
    throw new Error("child command must end with - so the prompt is read from stdin");
  return [...command.slice(0, -1), "--output-last-message", finalFile, "-"];
}

function jobPaths(jobDir) {
  return {
    dir: jobDir,
    manifest: path.join(jobDir, "job.json"),
    owner: path.join(jobDir, "owner.json"),
    prompt: path.join(jobDir, "prompt.md"),
    events: path.join(jobDir, "events.jsonl"),
    telemetry: path.join(jobDir, "telemetry.jsonl"),
    stderr: path.join(jobDir, "stderr.log"),
    final: path.join(jobDir, "last.md"),
    terminal: path.join(jobDir, "terminal.json"),
    cancel: path.join(jobDir, "cancel.request.json"),
  };
}

function startJob(argv, env = process.env) {
  const separator = argv.indexOf("--");
  if (separator < 0) throw new Error("start requires a -- separator before the Codex command");
  const { options, positionals } = parseOptions(argv.slice(0, separator), {
    values: ["prompt", "workspace", "title", "heartbeat-ms", "state-root"],
    booleans: ["json"],
  });
  if (positionals.length > 0) throw new Error(`unexpected start argument: ${positionals[0]}`);
  if (!options.prompt) throw new Error("start requires --prompt FILE");
  const sourcePrompt = path.resolve(options.prompt);
  const promptStat = fs.statSync(sourcePrompt);
  if (!promptStat.isFile()) throw new Error(`prompt is not a file: ${sourcePrompt}`);
  const heartbeatMs = numberOption(options["heartbeat-ms"], DEFAULT_HEARTBEAT_MS, "heartbeat-ms", { min: 1 });
  const workspace = canonicalWorkspace(options.workspace);
  const requestedCommand = argv.slice(separator + 1);
  buildManagedCommand(requestedCommand, "managed-final-message");
  const scopeDir = workspaceScopeDir(workspace, options, env);
  fs.mkdirSync(scopeDir, { recursive: true });

  let id;
  let paths;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    id = createJobId();
    paths = jobPaths(path.join(scopeDir, id));
    try {
      fs.mkdirSync(paths.dir);
      break;
    } catch (error) {
      if (error.code !== "EEXIST" || attempt === 7) throw error;
    }
  }
  fs.copyFileSync(sourcePrompt, paths.prompt, fs.constants.COPYFILE_EXCL);
  const command = buildManagedCommand(requestedCommand, paths.final);
  const ownerToken = randomBytes(16).toString("hex");
  const runnerArgs = [
    RUNNER,
    "--prompt", paths.prompt,
    "--events", paths.events,
    "--telemetry", paths.telemetry,
    "--stderr", paths.stderr,
    "--owner-file", paths.owner,
    "--owner-token", ownerToken,
    "--terminal-file", paths.terminal,
    "--cancel-file", paths.cancel,
    "--job-id", id,
    "--heartbeat-ms", String(heartbeatMs),
    "--",
    ...command,
  ];
  const manifest = {
    version: JOB_VERSION,
    id,
    title: options.title || "Codex job",
    created_at: new Date().toISOString(),
    workspace,
    heartbeat_ms: heartbeatMs,
    state_root: resolveJobRoot(options, env),
    launcher_pid: process.pid,
    runner_pid: null,
    owner_token: ownerToken,
    source_prompt: sourcePrompt,
    command,
    artifacts: paths,
  };
  writeJsonExclusive(paths.manifest, manifest);
  const runner = spawn(process.execPath, runnerArgs, {
    cwd: workspace,
    env,
    detached: true,
    shell: false,
    stdio: "ignore",
    windowsHide: true,
  });
  runner.once("error", (error) => {
    try {
      writeJsonAtomicIfAbsent(paths.terminal, {
        version: 1,
        job_id: id,
        type: "runner.failed",
        timestamp: new Date().toISOString(),
        exit_code: 127,
        signal: null,
        error: error.message,
      });
    } catch { /* status will become stale if even failure publication is unavailable */ }
  });
  runner.unref();
  return { manifest, asJson: Boolean(options.json) };
}

function readTail(file, maxBytes = MAX_TAIL_BYTES) {
  if (!fs.existsSync(file)) return "";
  const stat = fs.statSync(file);
  if (!stat.isFile() || stat.size === 0) return "";
  const bytes = Math.min(stat.size, maxBytes);
  const buffer = Buffer.alloc(bytes);
  const descriptor = fs.openSync(file, "r");
  try {
    fs.readSync(descriptor, buffer, 0, bytes, stat.size - bytes);
  } finally {
    fs.closeSync(descriptor);
  }
  let text = buffer.toString("utf8");
  if (bytes < stat.size) {
    const newline = text.indexOf("\n");
    text = newline >= 0 ? text.slice(newline + 1) : "";
  }
  return text;
}

function readJsonlTail(file) {
  const records = [];
  let parseError = null;
  for (const line of readTail(file).split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const record = JSON.parse(line);
      if (record && typeof record === "object" && !Array.isArray(record)) records.push(record);
    } catch (error) {
      parseError = error.message;
    }
  }
  return { records, parseError };
}

function safeStat(file) {
  try {
    const stat = fs.statSync(file);
    return stat.isFile() ? stat : null;
  } catch {
    return null;
  }
}

function processAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

function concise(value, limit = 120) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

function looksLikeVerification(command) {
  return /\b(test|tests|lint|build|typecheck|check|verify|validate|pytest|jest|vitest|cargo test|npm test|pnpm test|yarn test|go test|gradle|tsc|eslint|ruff)\b/i.test(command ?? "");
}

function describeEvent(event) {
  if (!event) return { phase: "starting", progress: "Waiting for Codex events." };
  if (event.type === "thread.started") return { phase: "starting", progress: `Thread ready (${event.thread_id ?? "unknown"}).` };
  if (event.type === "turn.started") return { phase: "reasoning", progress: "Turn started." };
  if (event.type === "turn.completed") return { phase: "finalizing", progress: "Turn completed; finalizing artifacts." };
  if (event.type === "turn.failed" || event.type === "error")
    return { phase: "failed", progress: concise(event.error?.message ?? event.message ?? "Codex reported an error.") };
  const item = event.item ?? {};
  const completed = event.type === "item.completed";
  const suffix = completed ? "completed" : "started";
  if (item.type === "command_execution") {
    return {
      phase: looksLikeVerification(item.command) ? "verifying" : "running",
      progress: `Command ${suffix}: ${concise(item.command)}`,
    };
  }
  if (item.type === "file_change") return { phase: "editing", progress: `File change ${suffix}.` };
  if (item.type === "mcp_tool_call")
    return { phase: "investigating", progress: `Tool ${suffix}: ${[item.server, item.tool].filter(Boolean).join("/") || "MCP"}` };
  if (item.type === "web_search") return { phase: "investigating", progress: `Search ${suffix}: ${concise(item.query)}` };
  if (item.type === "agent_message") return { phase: completed ? "finalizing" : "reasoning", progress: `Agent message ${suffix}.` };
  if (item.type === "reasoning") return { phase: "reasoning", progress: `Reasoning ${suffix}.` };
  return { phase: "running", progress: `${event.type}${item.type ? ` (${item.type})` : ""}.` };
}

function normalizedPath(file) {
  const resolved = path.resolve(file);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function readManifest(file) {
  const manifest = JSON.parse(fs.readFileSync(file, "utf8"));
  if (manifest.version !== JOB_VERSION || typeof manifest.id !== "string")
    throw new Error(`unsupported or malformed job manifest: ${file}`);
  if (typeof manifest.owner_token !== "string" || manifest.owner_token.length < 8)
    throw new Error(`job manifest has no valid owner token: ${file}`);
  const directory = path.dirname(path.resolve(file));
  if (manifest.id !== path.basename(directory))
    throw new Error(`job id does not match its directory: ${file}`);
  const expected = jobPaths(directory);
  if (!manifest.artifacts || typeof manifest.artifacts !== "object")
    throw new Error(`job manifest has no artifact map: ${file}`);
  for (const [name, expectedPath] of Object.entries(expected)) {
    const actual = manifest.artifacts[name];
    if (typeof actual !== "string" || normalizedPath(actual) !== normalizedPath(expectedPath))
      throw new Error(`job artifact escapes its directory (${name}): ${file}`);
  }
  return manifest;
}

function readTerminal(manifest) {
  if (!fs.existsSync(manifest.artifacts.terminal)) return { terminal: null, error: null };
  try {
    const record = JSON.parse(fs.readFileSync(manifest.artifacts.terminal, "utf8"));
    const statuses = {
      "runner.completed": "completed",
      "runner.failed": "failed",
      "runner.cancelled": "cancelled",
    };
    if (record?.job_id !== manifest.id || !statuses[record?.type] || !Number.isInteger(record.exit_code))
      throw new Error("terminal record identity, type, or exit code is invalid");
    if (record.type === "runner.completed" && record.exit_code !== 0)
      throw new Error("completed terminal record has a nonzero exit code");
    if (record.type === "runner.completed"
        && (!Number.isInteger(record.final?.size) || record.final.size <= 0
          || !/^[a-f0-9]{64}$/.test(record.final?.sha256 ?? ""))) {
      throw new Error("completed terminal record has no valid final artifact commitment");
    }
    return { terminal: { status: statuses[record.type], record }, error: null };
  } catch (error) {
    return { terminal: null, error: error.message };
  }
}

function verifyFinalArtifact(manifest, terminal) {
  if (!terminal || terminal.status !== "completed") return { ready: false, error: null };
  try {
    const bytes = fs.readFileSync(manifest.artifacts.final);
    if (bytes.length !== terminal.record.final.size)
      throw new Error("final artifact size differs from terminal commitment");
    const digest = createHash("sha256").update(bytes).digest("hex");
    if (digest !== terminal.record.final.sha256)
      throw new Error("final artifact hash differs from terminal commitment");
    return { ready: true, error: null };
  } catch (error) {
    return { ready: false, error: error.message };
  }
}

function readOwner(manifest) {
  if (!fs.existsSync(manifest.artifacts.owner)) return { owner: null, error: null };
  try {
    const owner = JSON.parse(fs.readFileSync(manifest.artifacts.owner, "utf8"));
    if (owner?.job_id !== manifest.id || owner?.owner_token !== manifest.owner_token
        || !Number.isInteger(owner.runner_pid) || owner.runner_pid <= 0) {
      throw new Error("owner record identity, token, or PID is invalid");
    }
    return { owner, error: null };
  } catch (error) {
    return { owner: null, error: error.message };
  }
}

function readCancelRequest(manifest) {
  if (!fs.existsSync(manifest.artifacts.cancel)) return { request: null, error: null };
  try {
    const request = JSON.parse(fs.readFileSync(manifest.artifacts.cancel, "utf8"));
    if (request?.job_id !== manifest.id) throw new Error("cancel request job_id is invalid");
    return { request, error: null };
  } catch (error) {
    return { request: null, error: error.message };
  }
}

function ensureCancelRequest(manifest) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const existing = readCancelRequest(manifest);
    if (existing.request) return false;
    if (existing.error) {
      const quarantined = path.join(
        manifest.artifacts.dir,
        `cancel.invalid-${Date.now()}-${randomBytes(3).toString("hex")}.json`,
      );
      try {
        fs.renameSync(manifest.artifacts.cancel, quarantined);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      continue;
    }
    if (writeJsonAtomicIfAbsent(manifest.artifacts.cancel, {
      version: 1,
      job_id: manifest.id,
      requested_at: new Date().toISOString(),
      requester_pid: process.pid,
    })) return true;
  }
  throw new Error(`could not publish a valid cancel request for ${manifest.id}`);
}

function listManifests(workspace, options = {}, env = process.env) {
  const scopeDir = workspaceScopeDir(workspace, options, env);
  if (!fs.existsSync(scopeDir)) return [];
  const jobs = [];
  for (const entry of fs.readdirSync(scopeDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const file = path.join(scopeDir, entry.name, "job.json");
    if (!fs.existsSync(file)) continue;
    try {
      jobs.push(readManifest(file));
    } catch {
      // One corrupt job must not hide every other job in the workspace.
    }
  }
  return jobs.sort((left, right) => String(right.created_at).localeCompare(String(left.created_at)));
}

function selectManifest(workspace, reference, options = {}, env = process.env) {
  const jobs = listManifests(workspace, options, env);
  if (!reference) {
    if (jobs.length === 0) throw new Error("no Codex jobs found for this workspace");
    return jobs[0];
  }
  const exact = jobs.find((job) => job.id === reference);
  if (exact) return exact;
  const matches = jobs.filter((job) => job.id.startsWith(reference));
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) throw new Error(`ambiguous job id prefix: ${reference}`);
  throw new Error(`job not found in this workspace: ${reference}`);
}

function inspectJob(manifest, now = Date.now()) {
  const telemetry = readJsonlTail(manifest.artifacts.telemetry);
  const events = readJsonlTail(manifest.artifacts.events);
  const terminalState = readTerminal(manifest);
  const terminal = terminalState.terminal;
  const ownerState = readOwner(manifest);
  const cancelState = readCancelRequest(manifest);
  const runnerStarted = telemetry.records.find((record) => record.type === "runner.started");
  const runnerPid = ownerState.owner?.runner_pid ?? null;
  const alive = processAlive(runnerPid);
  const eventStat = safeStat(manifest.artifacts.events);
  const telemetryStat = safeStat(manifest.artifacts.telemetry);
  const ownerStat = safeStat(manifest.artifacts.owner);
  const terminalStat = safeStat(manifest.artifacts.terminal);
  const createdMs = Date.parse(manifest.created_at) || now;
  const eventActivityMs = eventStat?.size ? eventStat.mtimeMs : createdMs;
  const telemetryActivityMs = telemetryStat?.size ? telemetryStat.mtimeMs : createdMs;
  const ownerActivityMs = ownerStat?.size ? ownerStat.mtimeMs : createdMs;
  const terminalActivityMs = terminalStat?.size ? terminalStat.mtimeMs : createdMs;
  const activityMs = Math.max(eventActivityMs, telemetryActivityMs, ownerActivityMs, terminalActivityMs, createdMs);
  const quietMs = Math.max(0, now - eventActivityMs);
  const activityAgeMs = Math.max(0, now - activityMs);
  const unresponsiveAfterMs = Math.max(Number(manifest.heartbeat_ms || DEFAULT_HEARTBEAT_MS) * 3, 90_000);
  const cancelRequested = Boolean(cancelState.request);
  const lastEvent = events.records.at(-1) ?? null;
  const described = describeEvent(lastEvent);
  const finalState = verifyFinalArtifact(manifest, terminal);
  let status;
  let phase = described.phase;

  if (terminal) {
    status = terminal.status;
    phase = status === "completed" ? "done" : status;
  } else if (terminalState.error) {
    status = "failed";
    phase = "corrupt-terminal";
  } else if (ownerState.error) {
    status = "unresponsive";
    phase = "corrupt-owner";
  } else if (!alive && !ownerState.owner && !ownerState.error && now - createdMs <= STARTUP_GRACE_MS) {
    status = cancelRequested ? "cancelling" : "queued";
    phase = status;
  } else if (!alive) {
    status = "stale";
    phase = cancelRequested ? "cancelled-without-ack" : "stale";
  } else if (activityAgeMs > unresponsiveAfterMs) {
    status = "unresponsive";
    phase = cancelRequested ? "cancellation-unacknowledged" : "unresponsive";
  } else if (cancelRequested) {
    status = "cancelling";
    phase = "cancelling";
  } else {
    status = runnerStarted ? "running" : "queued";
  }

  return {
    id: manifest.id,
    title: manifest.title,
    workspace: manifest.workspace,
    status,
    phase,
    created_at: manifest.created_at,
    elapsed_ms: Math.max(0, now - createdMs),
    runner_pid: runnerPid,
    child_pid: runnerStarted?.child_pid ?? null,
    runner_alive: alive,
    cancel_requested: cancelRequested,
    cancel_request_error: cancelState.error,
    last_activity_at: new Date(activityMs).toISOString(),
    activity_age_ms: activityAgeMs,
    last_event: lastEvent?.type ?? null,
    quiet_ms: quietMs,
    progress: terminal
      ? `${terminal.record.type} (exit ${terminal.record.exit_code ?? "?"}).`
      : described.progress,
    exit_code: terminal?.record?.exit_code ?? null,
    error: terminal?.record?.error ?? terminalState.error ?? null,
    final_ready: finalState.ready,
    final_error: finalState.error,
    telemetry_error: telemetry.parseError,
    events_error: events.parseError,
    terminal_error: terminalState.error,
    owner_error: ownerState.error,
    artifacts: manifest.artifacts,
  };
}

function elapsedText(milliseconds) {
  const seconds = Math.max(0, Math.round(milliseconds / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${seconds % 60}s`;
}

function renderStatus(status) {
  return [
    `Job: ${status.id}`,
    `Title: ${status.title}`,
    `Status: ${status.status} (${status.phase})`,
    `Elapsed: ${elapsedText(status.elapsed_ms)}`,
    `Runner: ${status.runner_alive ? "alive" : "not alive"}${status.runner_pid ? ` (PID ${status.runner_pid})` : ""}`,
    `Last activity: ${elapsedText(status.activity_age_ms)} ago`,
    `Last Codex event: ${status.last_event ?? "none"}; quiet ${elapsedText(status.quiet_ms)}`,
    `Progress: ${status.progress}`,
    `Final: ${status.final_ready ? status.artifacts.final : "not ready"}`,
    `Events: ${status.artifacts.events}`,
    `Telemetry: ${status.artifacts.telemetry}`,
  ].join("\n");
}

function renderStatusTable(statuses) {
  const lines = [
    "| Job | Status | Phase | Elapsed | Last activity | Title |",
    "|---|---|---|---:|---:|---|",
  ];
  for (const status of statuses) {
    lines.push(`| ${status.id} | ${status.status} | ${status.phase} | ${elapsedText(status.elapsed_ms)} | ${elapsedText(status.activity_age_ms)} ago | ${concise(status.title).replace(/\|/g, "\\|")} |`);
  }
  return lines.join("\n");
}

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function waitForStatus(manifest, options) {
  const timeoutMs = numberOption(options["timeout-ms"], DEFAULT_WAIT_TIMEOUT_MS, "timeout-ms", { min: 1 });
  const pollMs = numberOption(options["poll-ms"], DEFAULT_POLL_MS, "poll-ms", { min: 25 });
  const deadline = Date.now() + timeoutMs;
  let status = inspectJob(manifest);
  while (!TERMINAL_STATUSES.has(status.status) && Date.now() < deadline) {
    await delay(pollMs);
    status = inspectJob(manifest);
  }
  return { status, timedOut: !TERMINAL_STATUSES.has(status.status) };
}

async function statusCommand(argv, env = process.env) {
  const { options, positionals } = parseOptions(argv, {
    values: ["workspace", "state-root", "timeout-ms", "poll-ms"],
    booleans: ["json", "all", "wait"],
  });
  if (positionals.length > 1) throw new Error("status accepts at most one job id");
  const workspace = canonicalWorkspace(options.workspace);
  if (options.all) {
    if (options.wait) throw new Error("status --all cannot be combined with --wait");
    const statuses = listManifests(workspace, options, env).map((manifest) => inspectJob(manifest));
    return { payload: { workspace, jobs: statuses }, rendered: statuses.length ? renderStatusTable(statuses) : "No Codex jobs found.", asJson: Boolean(options.json) };
  }
  const manifest = selectManifest(workspace, positionals[0], options, env);
  const waited = options.wait ? await waitForStatus(manifest, options) : { status: inspectJob(manifest), timedOut: false };
  return { payload: { workspace, job: waited.status, timed_out: waited.timedOut }, rendered: renderStatus(waited.status), asJson: Boolean(options.json), timedOut: waited.timedOut };
}

function stderrTail(file, limit = 4_000) {
  const text = readTail(file, limit).trim();
  return text.length > limit ? text.slice(-limit) : text;
}

function resultCommand(argv, env = process.env) {
  const { options, positionals } = parseOptions(argv, {
    values: ["workspace", "state-root"],
    booleans: ["json"],
  });
  if (positionals.length > 1) throw new Error("result accepts at most one job id");
  const workspace = canonicalWorkspace(options.workspace);
  const manifest = selectManifest(workspace, positionals[0], options, env);
  const status = inspectJob(manifest);
  if (!TERMINAL_STATUSES.has(status.status))
    throw new Error(`job ${status.id} is ${status.status}; use status before reading the result`);
  if (status.status === "completed"
      && (status.exit_code !== 0 || !status.final_ready || status.terminal_error)) {
    throw new Error(`job ${status.id} has an invalid completion record or final artifact`);
  }
  if (status.status === "completed") {
    const final = fs.readFileSync(status.artifacts.final, "utf8");
    return { payload: { workspace, job: status, result: final, stderr: "" }, rendered: final, asJson: Boolean(options.json), resultExitCode: 0 };
  }
  const failure = stderrTail(status.artifacts.stderr) || status.error || "";
  const rendered = [`Job ${status.id} ended as ${status.status} (exit ${status.exit_code ?? "unknown"}).`, failure].filter(Boolean).join("\n\n");
  const resultExitCode = status.status === "cancelled" ? 130 : status.status === "stale" ? 4 : 1;
  return { payload: { workspace, job: status, result: "", stderr: failure }, rendered, asJson: Boolean(options.json), resultExitCode };
}

async function cancelCommand(argv, env = process.env) {
  const { options, positionals } = parseOptions(argv, {
    values: ["workspace", "state-root", "timeout-ms", "poll-ms"],
    booleans: ["json"],
  });
  if (positionals.length > 1) throw new Error("cancel accepts at most one job id");
  const workspace = canonicalWorkspace(options.workspace);
  const manifest = selectManifest(workspace, positionals[0], options, env);
  let status = inspectJob(manifest);
  if (TERMINAL_STATUSES.has(status.status)) {
    return { payload: { workspace, job: status, already_terminal: true }, rendered: `Job ${status.id} is already ${status.status}.`, asJson: Boolean(options.json) };
  }
  if (status.status === "stale") {
    return { payload: { workspace, job: status, cancel_requested: false }, rendered: `Job ${status.id} is stale; no live runner was signalled.`, asJson: Boolean(options.json), stale: true };
  }
  ensureCancelRequest(manifest);
  const waited = await waitForStatus(manifest, {
    ...options,
    "timeout-ms": options["timeout-ms"] ?? 10_000,
    "poll-ms": options["poll-ms"] ?? 250,
  });
  status = waited.status;
  const rendered = TERMINAL_STATUSES.has(status.status)
    ? `Job ${status.id} is ${status.status}.`
    : `Cancellation requested for ${status.id}; current status is ${status.status}.`;
  return { payload: { workspace, job: status, cancel_requested: true, timed_out: waited.timedOut }, rendered, asJson: Boolean(options.json) };
}

function output(value, asJson) {
  process.stdout.write(asJson ? `${JSON.stringify(value, null, 2)}\n` : `${String(value).trimEnd()}\n`);
}

async function main() {
  const [command, ...rawArgv] = process.argv.slice(2);
  const argv = normalizeForwardedArgs(rawArgv);
  if (!command || command === "--help" || command === "-h") {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  if (command === "start") {
    const result = startJob(argv);
    const status = inspectJob(result.manifest);
    const context = `--workspace ${JSON.stringify(status.workspace)} --state-root ${JSON.stringify(result.manifest.state_root)}`;
    const payload = { job: status, commands: {
      status: `node ${JSON.stringify(fileURLToPath(import.meta.url))} status ${status.id} ${context}`,
      result: `node ${JSON.stringify(fileURLToPath(import.meta.url))} result ${status.id} ${context}`,
      cancel: `node ${JSON.stringify(fileURLToPath(import.meta.url))} cancel ${status.id} ${context}`,
    } };
    if (result.asJson) output(payload, true);
    else output([
      `Started ${status.id}.`,
      renderStatus(status),
      `Status command: ${payload.commands.status}`,
      `Result command: ${payload.commands.result}`,
      `Cancel command: ${payload.commands.cancel}`,
    ].join("\n"), false);
    return;
  }
  if (command === "status") {
    const result = await statusCommand(argv);
    output(result.asJson ? result.payload : result.rendered, result.asJson);
    if (result.timedOut) process.exitCode = 124;
    return;
  }
  if (command === "result") {
    const result = resultCommand(argv);
    output(result.asJson ? result.payload : result.rendered, result.asJson);
    process.exitCode = result.resultExitCode;
    return;
  }
  if (command === "cancel") {
    const result = await cancelCommand(argv);
    output(result.asJson ? result.payload : result.rendered, result.asJson);
    if (result.stale) process.exitCode = 4;
    return;
  }
  throw new Error(`unknown command: ${command}\n${usage()}`);
}

const invokedAsScript = process.argv[1]
  && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (invokedAsScript) {
  main().catch((error) => {
    process.stderr.write(`[codex job] ${error.message}\n`);
    process.exitCode = 2;
  });
}

export {
  buildManagedCommand,
  inspectJob,
  listManifests,
  normalizeForwardedArgs,
  processAlive,
  resolveJobRoot,
  selectManifest,
  startJob,
  statusCommand,
  resultCommand,
  cancelCommand,
  workspaceScopeDir,
};
