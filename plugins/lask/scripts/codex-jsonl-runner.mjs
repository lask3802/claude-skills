#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import readline from "node:readline";
import { finished } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const DEFAULT_HEARTBEAT_MS = 30_000;
const SIGNAL_EXIT_CODE = { SIGHUP: 129, SIGINT: 130, SIGTERM: 143 };

function usage() {
  return [
    "Usage:",
    "  node codex-jsonl-runner.mjs --prompt FILE --events FILE --telemetry FILE",
    "    --stderr FILE [--heartbeat-ms N] -- codex exec ... --json",
    "    --output-last-message FILE -",
  ].join("\n");
}

function childOption(command, name) {
  const exact = command.indexOf(name);
  if (exact >= 0) return command[exact + 1];
  const prefix = `${name}=`;
  const joined = command.find((argument) => argument.startsWith(prefix));
  return joined?.slice(prefix.length);
}

function parseArgs(argv) {
  const separator = argv.indexOf("--");
  if (separator < 0) throw new Error(`missing command separator --\n${usage()}`);

  const options = { heartbeatMs: DEFAULT_HEARTBEAT_MS };
  for (let index = 0; index < separator; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (["--prompt", "--events", "--telemetry", "--stderr"].includes(flag)) {
      if (!value) throw new Error(`${flag} requires a path`);
      options[flag.slice(2)] = value;
      index += 1;
      continue;
    }
    if (flag === "--heartbeat-ms") {
      const parsed = Number(value);
      if (!Number.isFinite(parsed) || parsed < 0)
        throw new Error("--heartbeat-ms must be a non-negative number");
      options.heartbeatMs = parsed;
      index += 1;
      continue;
    }
    if (flag === "--help" || flag === "-h") {
      process.stdout.write(`${usage()}\n`);
      process.exit(0);
    }
    throw new Error(`unknown runner option: ${flag}`);
  }

  for (const key of ["prompt", "events", "telemetry", "stderr"])
    if (!options[key]) throw new Error(`missing required --${key}`);

  const command = argv.slice(separator + 1);
  if (command.length === 0) throw new Error("missing command after --");
  if (!command.includes("--json"))
    throw new Error("child command must include --json so stdout is a JSONL event stream");
  const final = childOption(command, "--output-last-message");
  if (!final)
    throw new Error("child command must include --output-last-message FILE");

  return { ...options, final, command };
}

function findOnPath(fileName) {
  for (const directory of (process.env.PATH || "").split(path.delimiter)) {
    if (!directory) continue;
    const candidate = path.join(directory.replace(/^"|"$/g, ""), fileName);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

export function resolveCommand(command, args) {
  if (process.platform !== "win32") return { executable: command, args };

  const extension = path.extname(command).toLowerCase();
  const commandName = path.basename(command, extension).toLowerCase();
  if (commandName !== "codex") return { executable: command, args };
  if (extension === ".exe" && fs.existsSync(command))
    return { executable: command, args };

  const explicitDirectory = path.dirname(command) !== "." ? path.dirname(command) : null;
  const shim = explicitDirectory
    ? path.join(explicitDirectory, "codex.ps1")
    : findOnPath("codex.ps1") || findOnPath("codex.cmd");
  const shimDirectory = shim && fs.existsSync(shim) ? path.dirname(shim) : null;
  const arch = process.arch === "arm64" ? "arm64" : "x64";
  const target = process.arch === "arm64"
    ? "aarch64-pc-windows-msvc"
    : "x86_64-pc-windows-msvc";
  const packageRoots = shimDirectory ? [
    // Global npm layout: <global-bin>/node_modules/@openai/codex.
    path.join(shimDirectory, "node_modules", "@openai", "codex"),
    // Project-local npm/pnpm layout: node_modules/.bin/codex.* points at
    // the sibling node_modules/@openai/codex package.
    path.join(shimDirectory, "..", "@openai", "codex"),
  ] : [];
  const candidates = packageRoots.flatMap((packageRoot) => [
    path.join(packageRoot, "node_modules", "@openai", `codex-win32-${arch}`,
      "vendor", target, "bin", "codex.exe"),
    path.join(packageRoot, "vendor", target, "bin", "codex.exe"),
  ]);
  if (explicitDirectory) candidates.push(path.join(explicitDirectory, "codex.exe"));
  const pathExe = findOnPath("codex.exe");
  if (pathExe) candidates.push(pathExe);
  const executable = candidates.find((candidate) => fs.existsSync(candidate));
  if (executable) return { executable, args };

  throw new Error(
    "could not locate the native Codex executable on Windows; reinstall @openai/codex",
  );
}

export function terminateProcessTree(child, signal = "SIGTERM") {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return null;

  if (process.platform === "win32") {
    const taskkill = process.env.SystemRoot
      ? path.join(process.env.SystemRoot, "System32", "taskkill.exe")
      : "taskkill.exe";
    const result = spawnSync(taskkill, ["/PID", String(child.pid), "/T", "/F"], {
      shell: false,
      stdio: "ignore",
      windowsHide: true,
    });
    if (result.error || result.status !== 0) {
      try { child.kill(); } catch { /* child already exited */ }
    }
    return null;
  }

  try {
    process.kill(-child.pid, signal);
  } catch {
    try { child.kill(signal); } catch { /* child already exited */ }
  }
  const escalation = setTimeout(() => {
    // Kill the process group even if its leader has already exited: a resistant
    // descendant may still own the group.
    try { process.kill(-child.pid, "SIGKILL"); } catch {
      if (child.exitCode === null && child.signalCode === null) {
        try { child.kill("SIGKILL"); } catch { /* child already exited */ }
      }
    }
  }, 5_000);
  return escalation;
}

function ensureParent(file) {
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
}

function comparablePath(file) {
  const absolute = path.resolve(file);
  const canonical = path.join(fs.realpathSync(path.dirname(absolute)), path.basename(absolute));
  return process.platform === "win32" ? canonical.toLowerCase() : canonical;
}

function reserveOutputFiles(options) {
  for (const file of [options.events, options.telemetry, options.stderr, options.final])
    ensureParent(file);

  const paths = [options.prompt, options.events, options.telemetry, options.stderr, options.final]
    .map(comparablePath);
  if (new Set(paths).size !== paths.length)
    throw new Error("prompt, events, telemetry, stderr, and final-message files must all differ");

  for (const file of [options.events, options.telemetry, options.stderr, options.final]) {
    if (fs.existsSync(file))
      throw new Error(`refusing to overwrite prior-run artifact: ${file}`);
  }

  const descriptors = [];
  try {
    for (const file of [options.events, options.telemetry, options.stderr])
      descriptors.push(fs.openSync(file, "wx"));
  } catch (error) {
    for (const descriptor of descriptors) fs.closeSync(descriptor);
    throw error;
  }
  return descriptors;
}

function elapsed(startedAt) {
  return `${((Date.now() - startedAt) / 1000).toFixed(1)}s`;
}

function concise(value, limit = 180) {
  if (value == null) return "";
  const text = typeof value === "string" ? value : JSON.stringify(value);
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > limit ? `${oneLine.slice(0, limit - 1)}…` : oneLine;
}

function itemDetail(item = {}) {
  const kind = item.type || "unknown-item";
  if (kind === "command_execution") return `${kind}: ${concise(item.command)}`;
  if (kind === "mcp_tool_call") {
    const tool = [item.server, item.tool].filter(Boolean).join("/");
    return `${kind}${tool ? `: ${tool}` : ""}`;
  }
  if (kind === "web_search") return `${kind}: ${concise(item.query)}`;
  if (kind === "agent_message") return `${kind}: ${concise(item.text)}`;
  return kind;
}

function eventDetail(event) {
  if (event.type === "thread.started") return concise(event.thread_id);
  if (event.type?.startsWith("item.")) return itemDetail(event.item);
  if (event.type === "turn.completed") return concise(event.usage);
  if (event.type === "turn.failed" || event.type === "error")
    return concise(event.error || event.message || event);
  return "";
}

function writeChunk(stream, chunk) {
  return new Promise((resolve, reject) => {
    const onError = (error) => { cleanup(); reject(error); };
    const onDrain = () => { cleanup(); resolve(); };
    const cleanup = () => {
      stream.off("error", onError);
      stream.off("drain", onDrain);
    };
    stream.once("error", onError);
    try {
      if (stream.write(chunk)) {
        cleanup();
        resolve();
      } else {
        stream.once("drain", onDrain);
      }
    } catch (error) {
      cleanup();
      reject(error);
    }
  });
}

async function endStream(stream) {
  if (stream.destroyed) return;
  stream.end();
  await finished(stream);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  fs.accessSync(options.prompt, fs.constants.R_OK);
  const promptBytes = fs.readFileSync(options.prompt);
  const [requestedExecutable, ...childArgs] = options.command;
  const resolved = resolveCommand(requestedExecutable, childArgs);
  const [eventsFd, telemetryFd, stderrFd] = reserveOutputFiles(options);
  const eventsFile = fs.createWriteStream(options.events, { fd: eventsFd, autoClose: true });
  const telemetryFile = fs.createWriteStream(options.telemetry, { fd: telemetryFd, autoClose: true });
  const stderrFile = fs.createWriteStream(options.stderr, { fd: stderrFd, autoClose: true });

  const startedAt = Date.now();
  let lastEventType = "none";
  let lastEventAt = startedAt;
  let spawnError = null;
  let stdinError = null;
  let fatalError = null;
  let forwardedSignal = null;
  let terminationRequested = false;
  let escalationTimer = null;
  let progressTail = Promise.resolve();
  let telemetryTail = Promise.resolve();
  let child = null;

  const queueProgress = (type, detail = "") => {
    const line = `[codex ${elapsed(startedAt)}] ${type}${detail ? ` | ${detail}` : ""}\n`;
    progressTail = progressTail.then(() => writeChunk(process.stdout, line));
    return progressTail;
  };
  const queueTelemetry = (type, extra = {}) => {
    const record = JSON.stringify({
      type,
      timestamp: new Date().toISOString(),
      elapsed_ms: Date.now() - startedAt,
      ...extra,
    });
    telemetryTail = telemetryTail.then(() => writeChunk(telemetryFile, `${record}\n`));
    return telemetryTail;
  };
  const announce = (type, detail = "", extra = {}) =>
    Promise.all([queueProgress(type, detail), queueTelemetry(type, extra)]);
  const failRun = (error) => {
    if (!fatalError) fatalError = error instanceof Error ? error : new Error(String(error));
    terminationRequested = true;
    if (child && !escalationTimer)
      escalationTimer = terminateProcessTree(child, "SIGTERM");
  };
  for (const stream of [eventsFile, telemetryFile, stderrFile])
    stream.on("error", failRun);

  child = spawn(resolved.executable, resolved.args, {
    detached: process.platform !== "win32",
    shell: false,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });

  child.once("error", (error) => { spawnError = error; });
  child.stdin.once("error", (error) => { stdinError = error; });
  const childResult = new Promise((resolve) => {
    child.once("close", (code, signal) => resolve({ code, signal }));
  });

  const signalHandlers = new Map();
  for (const signal of ["SIGHUP", "SIGINT", "SIGTERM"]) {
    const handler = () => {
      forwardedSignal = signal;
      terminationRequested = true;
      void announce("runner.signal", `${signal}; terminating child tree`, { signal })
        .catch(failRun);
      if (!escalationTimer) escalationTimer = terminateProcessTree(child, signal);
    };
    signalHandlers.set(signal, handler);
    process.on(signal, handler);
  }

  try {
    await announce("runner.started", `events=${options.events}`, {
      runner_pid: process.pid,
      child_pid: child.pid ?? null,
      artifacts: {
        events: path.resolve(options.events),
        telemetry: path.resolve(options.telemetry),
        stderr: path.resolve(options.stderr),
        final: path.resolve(options.final),
      },
    });
  } catch (error) {
    failRun(error);
  }

  child.stdin.end(promptBytes);

  const stderrCapture = (async () => {
    for await (const chunk of child.stderr) {
      await writeChunk(stderrFile, chunk);
      await writeChunk(process.stderr, chunk);
    }
  })();

  const lines = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
  const eventsCapture = (async () => {
    for await (const line of lines) {
      let event;
      try {
        event = JSON.parse(line);
        if (!event || typeof event !== "object" || Array.isArray(event) || typeof event.type !== "string")
          throw new Error("event must be an object with a string type");
      } catch (error) {
        throw new Error(`invalid Codex JSONL stdout (${error.message}): ${concise(line)}`);
      }
      await writeChunk(eventsFile, `${line}\n`);
      lastEventType = event.type;
      lastEventAt = Date.now();
      await queueProgress(lastEventType, eventDetail(event));
    }
  })();

  const capture = Promise.all([stderrCapture, eventsCapture]).catch((error) => {
    failRun(error);
  });
  const heartbeat = options.heartbeatMs > 0
    ? setInterval(() => {
        const quietMs = Date.now() - lastEventAt;
        if (quietMs < options.heartbeatMs) return;
        void announce(
          "heartbeat",
          `alive; last=${lastEventType}; quiet=${(quietMs / 1000).toFixed(1)}s`,
          { child_pid: child.pid ?? null, last_event: lastEventType, quiet_ms: quietMs },
        ).catch(failRun);
      }, options.heartbeatMs)
    : null;
  heartbeat?.unref();

  const result = await childResult;
  if (heartbeat) clearInterval(heartbeat);
  for (const [signal, handler] of signalHandlers) process.removeListener(signal, handler);
  if (terminationRequested && process.platform !== "win32" && child.pid) {
    try { process.kill(-child.pid, "SIGKILL"); } catch { /* group already gone */ }
  }
  if (escalationTimer) clearTimeout(escalationTimer);
  await capture;
  try { await progressTail; } catch (error) { failRun(error); }

  try {
    for (const stream of [eventsFile, stderrFile]) {
      if (!stream.destroyed && Number.isInteger(stream.fd)) fs.fsyncSync(stream.fd);
    }
    await Promise.all([endStream(eventsFile), endStream(stderrFile)]);
  } catch (error) {
    failRun(error);
  }

  const calculateExitCode = () => {
    if (forwardedSignal) return SIGNAL_EXIT_CODE[forwardedSignal] || 1;
    if (spawnError) return 127;
    if (fatalError) return 74;
    if (Number.isInteger(result.code)) return result.code;
    return result.signal ? (SIGNAL_EXIT_CODE[result.signal] || 1) : 1;
  };
  let exitCode = calculateExitCode();
  if (exitCode === 0 && stdinError) {
    fatalError = stdinError;
    exitCode = 74;
  }
  if (exitCode === 0) {
    const finalStat = fs.existsSync(options.final) ? fs.statSync(options.final) : null;
    if (!finalStat?.isFile() || finalStat.size === 0) {
      fatalError = new Error(`Codex exited zero without a non-empty final-message artifact: ${options.final}`);
      exitCode = 66;
    }
  }

  const completionType = exitCode === 0 ? "runner.completed" : "runner.failed";
  const detail = `exit=${exitCode}${result.signal ? `; signal=${result.signal}` : ""}`;
  try {
    await announce(completionType, detail, {
      exit_code: exitCode,
      signal: result.signal || forwardedSignal,
      error: fatalError?.message || spawnError?.message || null,
    });
    await Promise.all([progressTail, telemetryTail]);
  } catch (error) {
    fatalError ||= error;
    exitCode = calculateExitCode();
  }

  try {
    await telemetryTail;
    if (!telemetryFile.destroyed && Number.isInteger(telemetryFile.fd))
      fs.fsyncSync(telemetryFile.fd);
    await endStream(telemetryFile);
  } catch (error) {
    fatalError ||= error;
    exitCode = calculateExitCode();
  }
  if (fatalError)
    process.stderr.write(`[codex runner] ${fatalError.message}\n`);
  else if (spawnError)
    process.stderr.write(`[codex runner] ${spawnError.message}\n`);
  process.exitCode = exitCode;
}

const invokedAsScript = process.argv[1]
  && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (invokedAsScript) {
  main().catch((error) => {
    process.stderr.write(`[codex runner] ${error.message}\n`);
    process.exitCode = 2;
  });
}
