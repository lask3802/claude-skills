import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const JOB = path.join(PLUGIN_ROOT, "scripts", "codex-job.mjs");
const RUNNER = path.join(PLUGIN_ROOT, "scripts", "codex-jsonl-runner.mjs");
const jobModule = await import(pathToFileURL(JOB));

function writeFakeCodex(directory) {
  const fake = path.join(directory, "fake codex.mjs");
  fs.writeFileSync(fake, `
import fs from "node:fs";
import process from "node:process";
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let prompt = "";
process.stdin.setEncoding("utf8");
for await (const chunk of process.stdin) prompt += chunk;
const hold = process.argv.find((arg) => arg.startsWith("--fake-hold="));
const holdMs = hold ? Number(hold.split("=")[1]) : 80;
const finalIndex = process.argv.indexOf("--output-last-message");
const final = finalIndex >= 0 ? process.argv[finalIndex + 1] : null;
process.stdout.write(JSON.stringify({type:"thread.started",thread_id:"job-test"}) + "\\n");
await delay(holdMs);
process.stdout.write(JSON.stringify({type:"item.started",item:{type:"command_execution",command:"npm test"}}) + "\\n");
if (final) fs.writeFileSync(final, "FINAL:" + prompt, "utf8");
if (process.argv.includes("--fake-turn-failed-zero")) {
  process.stdout.write(JSON.stringify({type:"turn.failed",error:{message:"synthetic failure"}}) + "\\n");
} else {
  process.stdout.write(JSON.stringify({type:"turn.completed",usage:{output_tokens:1}}) + "\\n");
}
const exitArg = process.argv.find((arg) => arg.startsWith("--fake-exit="));
if (exitArg) process.exitCode = Number(exitArg.split("=")[1]);
`, "utf8");
  return fake;
}

function runCli(args, { timeout = 10_000 } = {}) {
  return spawnSync(process.execPath, [JOB, ...args], {
    encoding: "utf8",
    timeout,
    windowsHide: true,
  });
}

function jsonCli(args, options) {
  const result = runCli(args, options);
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

function baseStart({ prompt, workspace, stateRoot, fake, hold = 80, title = "Test job", extra = [] }) {
  return [
    "start", "--prompt", prompt,
    "--workspace", workspace,
    "--state-root", stateRoot,
    "--title", title,
    "--heartbeat-ms", "50",
    "--json", "--",
    process.execPath, fake, "--json", `--fake-hold=${hold}`, ...extra, "-",
  ];
}

async function waitFor(check, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = check();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("timed out waiting for condition");
}

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

test("managed jobs start detached, expose semantic status, and return the exact final artifact", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "lask-codex-job-complete-"));
  const workspace = path.join(directory, "workspace");
  const stateRoot = path.join(directory, "state");
  fs.mkdirSync(workspace);
  const fake = writeFakeCodex(directory);
  const prompt = path.join(directory, "prompt.md");
  fs.writeFileSync(prompt, "CHECK_THIS\n", "utf8");

  const started = jsonCli(baseStart({ prompt, workspace, stateRoot, fake }));
  assert.match(started.job.id, /^codex-/);
  assert.ok(["queued", "running"].includes(started.job.status));
  assert.equal(fs.readFileSync(started.job.artifacts.prompt, "utf8"), "CHECK_THIS\n");
  assert.equal(started.job.artifacts.dir, path.dirname(started.job.artifacts.manifest));

  const waited = jsonCli([
    "status", started.job.id, "--workspace", workspace, "--state-root", stateRoot,
    "--wait", "--timeout-ms", "5000", "--poll-ms", "25", "--json",
  ]);
  assert.equal(waited.timed_out, false);
  assert.equal(waited.job.status, "completed");
  assert.equal(waited.job.phase, "done");
  assert.equal(waited.job.final_ready, true);

  const result = jsonCli([
    "result", started.job.id, "--workspace", workspace, "--state-root", stateRoot, "--json",
  ]);
  assert.equal(result.result, "FINAL:CHECK_THIS\n");
  const telemetry = fs.readFileSync(started.job.artifacts.telemetry, "utf8")
    .trim().split(/\r?\n/).map(JSON.parse);
  assert.equal(telemetry.at(-1).type, "runner.completed");
  assert.ok(telemetry.every((record) => record.job_id === started.job.id));

  const human = runCli(["status", started.job.id, "--workspace", workspace, "--state-root", stateRoot]);
  assert.equal(human.status, 0);
  assert.match(human.stdout, /Status: completed \(done\)/);
  assert.doesNotMatch(human.stdout, /\[object Object\]/);

  fs.writeFileSync(started.job.artifacts.final, "X".repeat("FINAL:CHECK_THIS\n".length), "utf8");
  const replacedFinal = runCli([
    "result", started.job.id, "--workspace", workspace, "--state-root", stateRoot,
  ]);
  assert.equal(replacedFinal.status, 2);
  assert.match(replacedFinal.stderr, /invalid completion record or final artifact/);
  fs.unlinkSync(started.job.artifacts.final);
  const missingFinal = runCli([
    "result", started.job.id, "--workspace", workspace, "--state-root", stateRoot,
  ]);
  assert.equal(missingFinal.status, 2);
  assert.match(missingFinal.stderr, /invalid completion record or final artifact/);
});

test("turn.failed with exit zero and nonzero child exits cannot publish a consumable result", () => {
  for (const scenario of [
    { name: "semantic", extra: ["--fake-turn-failed-zero"], expectedExit: 74 },
    { name: "process", extra: ["--fake-exit=9"], expectedExit: 9 },
  ]) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), `lask-codex-job-${scenario.name}-failure-`));
    const workspace = path.join(directory, "workspace");
    const stateRoot = path.join(directory, "state");
    fs.mkdirSync(workspace);
    const fake = writeFakeCodex(directory);
    const prompt = path.join(directory, "prompt.md");
    fs.writeFileSync(prompt, "FAIL_CLOSED", "utf8");
    const started = jsonCli(baseStart({ prompt, workspace, stateRoot, fake, extra: scenario.extra }));
    const waited = jsonCli([
      "status", started.job.id, "--workspace", workspace, "--state-root", stateRoot,
      "--wait", "--timeout-ms", "5000", "--poll-ms", "25", "--json",
    ]);
    assert.equal(waited.job.status, "failed");
    assert.equal(waited.job.exit_code, scenario.expectedExit);
    const result = runCli([
      "result", started.job.id, "--workspace", workspace, "--state-root", stateRoot, "--json",
    ]);
    assert.equal(result.status, 1);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.result, "");
    assert.notEqual(payload.job.status, "completed");
  }
});

test("cancel request is acknowledged by the owning runner and kills its child tree", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "lask-codex-job-cancel-"));
  const workspace = path.join(directory, "workspace");
  const stateRoot = path.join(directory, "state");
  fs.mkdirSync(workspace);
  const fake = writeFakeCodex(directory);
  const prompt = path.join(directory, "prompt.md");
  fs.writeFileSync(prompt, "CANCEL_ME", "utf8");
  const started = jsonCli(baseStart({ prompt, workspace, stateRoot, fake, hold: 5000 }));

  const running = await waitFor(() => {
    const status = jsonCli(["status", started.job.id, "--workspace", workspace, "--state-root", stateRoot, "--json"]);
    return status.job.child_pid ? status.job : null;
  });
  assert.equal(pidAlive(running.child_pid), true);

  const cancelled = jsonCli([
    "cancel", started.job.id, "--workspace", workspace, "--state-root", stateRoot,
    "--timeout-ms", "5000", "--poll-ms", "25", "--json",
  ]);
  assert.equal(cancelled.job.status, "cancelled");
  assert.equal(cancelled.job.exit_code, 130);
  await waitFor(() => !pidAlive(running.child_pid));
  const telemetry = fs.readFileSync(started.job.artifacts.telemetry, "utf8")
    .trim().split(/\r?\n/).map(JSON.parse);
  assert.ok(telemetry.some((record) => record.type === "runner.cancel.requested"));
  assert.equal(telemetry.at(-1).type, "runner.cancelled");
  assert.equal(fs.existsSync(started.job.artifacts.final), false);
  const cancelledResult = runCli([
    "result", started.job.id, "--workspace", workspace, "--state-root", stateRoot, "--json",
  ]);
  assert.equal(cancelledResult.status, 130);
  assert.equal(JSON.parse(cancelledResult.stdout).result, "");
});

test("immediate cancellation is acknowledged even during runner startup", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "lask-codex-job-immediate-cancel-"));
  const workspace = path.join(directory, "workspace");
  const stateRoot = path.join(directory, "state");
  fs.mkdirSync(workspace);
  const fake = writeFakeCodex(directory);
  const prompt = path.join(directory, "prompt.md");
  fs.writeFileSync(prompt, "CANCEL_BEFORE_STARTED", "utf8");
  const started = jsonCli(baseStart({ prompt, workspace, stateRoot, fake, hold: 5000 }));
  const cancelled = jsonCli([
    "cancel", started.job.id, "--workspace", workspace, "--state-root", stateRoot,
    "--timeout-ms", "5000", "--poll-ms", "25", "--json",
  ]);
  assert.equal(cancelled.job.status, "cancelled");
  assert.equal(cancelled.job.exit_code, 130);
  assert.equal(fs.existsSync(started.job.artifacts.terminal), true);
});

test("runner accepts a valid cancel request that predates startup", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "lask-codex-job-prestart-cancel-"));
  const fake = writeFakeCodex(directory);
  const id = "codex-prestart-cancel";
  const paths = {
    prompt: path.join(directory, "prompt.md"),
    events: path.join(directory, "events.jsonl"),
    telemetry: path.join(directory, "telemetry.jsonl"),
    stderr: path.join(directory, "stderr.log"),
    final: path.join(directory, "last.md"),
    terminal: path.join(directory, "terminal.json"),
    cancel: path.join(directory, "cancel.request.json"),
  };
  fs.writeFileSync(paths.prompt, "PRESTART_CANCEL", "utf8");
  fs.writeFileSync(paths.cancel, `${JSON.stringify({
    version: 1,
    job_id: id,
    requested_at: new Date().toISOString(),
  })}\n`, "utf8");
  const child = spawn(process.execPath, [
    RUNNER,
    "--prompt", paths.prompt,
    "--events", paths.events,
    "--telemetry", paths.telemetry,
    "--stderr", paths.stderr,
    "--terminal-file", paths.terminal,
    "--cancel-file", paths.cancel,
    "--job-id", id,
    "--heartbeat-ms", "50",
    "--", process.execPath, fake, "--json", "--fake-hold=5000",
    "--output-last-message", paths.final, "-",
  ], { stdio: "ignore", windowsHide: true });
  const result = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({ code, signal }));
  });
  assert.equal(result.code, 130);
  const terminal = JSON.parse(fs.readFileSync(paths.terminal, "utf8"));
  assert.equal(terminal.type, "runner.cancelled");
  assert.equal(terminal.job_id, id);
});

test("runner publishes authenticated ownership and terminal failure before normal artifacts exist", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "lask-codex-job-bootstrap-failure-"));
  const fake = writeFakeCodex(directory);
  const id = "codex-bootstrap-failure";
  const ownerToken = "bootstrap-owner-token";
  const owner = path.join(directory, "owner.json");
  const terminal = path.join(directory, "terminal.json");
  const child = spawn(process.execPath, [
    RUNNER,
    "--prompt", path.join(directory, "missing-prompt.md"),
    "--events", path.join(directory, "events.jsonl"),
    "--telemetry", path.join(directory, "telemetry.jsonl"),
    "--stderr", path.join(directory, "stderr.log"),
    "--owner-file", owner,
    "--owner-token", ownerToken,
    "--terminal-file", terminal,
    "--cancel-file", path.join(directory, "cancel.request.json"),
    "--job-id", id,
    "--", process.execPath, fake, "--json",
    "--output-last-message", path.join(directory, "last.md"), "-",
  ], { stdio: "ignore", windowsHide: true });
  const result = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({ code, signal }));
  });
  assert.equal(result.code, 2);
  const ownerRecord = JSON.parse(fs.readFileSync(owner, "utf8"));
  assert.equal(ownerRecord.owner_token, ownerToken);
  assert.equal(ownerRecord.runner_pid, child.pid);
  const terminalRecord = JSON.parse(fs.readFileSync(terminal, "utf8"));
  assert.equal(terminalRecord.type, "runner.failed");
  assert.match(terminalRecord.error, /missing-prompt/);
});

test("malformed and mismatched cancel requests are ignored without terminating the job", () => {
  for (const [name, request] of [
    ["malformed", "{not-json"],
    ["mismatched", JSON.stringify({ version: 1, job_id: "another-job" })],
  ]) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), `lask-codex-job-${name}-cancel-`));
    const workspace = path.join(directory, "workspace");
    const stateRoot = path.join(directory, "state");
    fs.mkdirSync(workspace);
    const fake = writeFakeCodex(directory);
    const prompt = path.join(directory, "prompt.md");
    fs.writeFileSync(prompt, "DO_NOT_CANCEL", "utf8");
    const started = jsonCli(baseStart({ prompt, workspace, stateRoot, fake, hold: 350 }));
    fs.writeFileSync(started.job.artifacts.cancel, request, "utf8");
    const completed = jsonCli([
      "status", started.job.id, "--workspace", workspace, "--state-root", stateRoot,
      "--wait", "--timeout-ms", "5000", "--poll-ms", "25", "--json",
    ]);
    assert.equal(completed.job.status, "completed", `${name} request must not kill the child`);
    const telemetry = fs.readFileSync(started.job.artifacts.telemetry, "utf8")
      .trim().split(/\r?\n/).map(JSON.parse);
    assert.ok(telemetry.some((record) => record.type === "runner.cancel.ignored"));
    assert.ok(!telemetry.some((record) => record.type === "runner.cancelled"));
  }
});

test("a later real cancellation quarantines and recovers from a corrupt request", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "lask-codex-job-cancel-recovery-"));
  const workspace = path.join(directory, "workspace");
  const stateRoot = path.join(directory, "state");
  fs.mkdirSync(workspace);
  const fake = writeFakeCodex(directory);
  const prompt = path.join(directory, "prompt.md");
  fs.writeFileSync(prompt, "RECOVER_CANCEL", "utf8");
  const started = jsonCli(baseStart({ prompt, workspace, stateRoot, fake, hold: 5000 }));
  fs.writeFileSync(started.job.artifacts.cancel, "{corrupt", "utf8");
  await waitFor(() => {
    if (!fs.existsSync(started.job.artifacts.telemetry)) return false;
    return fs.readFileSync(started.job.artifacts.telemetry, "utf8").includes("runner.cancel.ignored");
  });
  const cancelled = jsonCli([
    "cancel", started.job.id, "--workspace", workspace, "--state-root", stateRoot,
    "--timeout-ms", "5000", "--poll-ms", "25", "--json",
  ]);
  assert.equal(cancelled.job.status, "cancelled");
  const quarantined = fs.readdirSync(started.job.artifacts.dir)
    .filter((file) => file.startsWith("cancel.invalid-"));
  assert.equal(quarantined.length, 1);
});

test("manifest artifact containment prevents one job from targeting another job's cancel file", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "lask-codex-job-containment-"));
  const workspace = path.join(directory, "workspace");
  const stateRoot = path.join(directory, "state");
  fs.mkdirSync(workspace);
  const fake = writeFakeCodex(directory);
  const prompt = path.join(directory, "prompt.md");
  fs.writeFileSync(prompt, "CONTAIN_CANCEL", "utf8");
  const first = jsonCli(baseStart({ prompt, workspace, stateRoot, fake, hold: 5000, title: "first" }));
  const second = jsonCli(baseStart({ prompt, workspace, stateRoot, fake, hold: 5000, title: "second" }));
  const original = fs.readFileSync(first.job.artifacts.manifest, "utf8");
  const corrupted = JSON.parse(original);
  corrupted.artifacts.cancel = second.job.artifacts.cancel;
  fs.writeFileSync(first.job.artifacts.manifest, `${JSON.stringify(corrupted, null, 2)}\n`, "utf8");
  try {
    const rejected = runCli([
      "cancel", first.job.id, "--workspace", workspace, "--state-root", stateRoot,
      "--timeout-ms", "100", "--json",
    ]);
    assert.equal(rejected.status, 2);
    assert.match(rejected.stderr, /job not found/);
    assert.equal(fs.existsSync(second.job.artifacts.cancel), false);
  } finally {
    fs.writeFileSync(first.job.artifacts.manifest, original, "utf8");
    for (const started of [first, second]) {
      jsonCli([
        "cancel", started.job.id, "--workspace", workspace, "--state-root", stateRoot,
        "--timeout-ms", "5000", "--poll-ms", "25", "--json",
      ]);
    }
  }
});

test("cancel never kills a PID copied from stale job metadata", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "lask-codex-job-pid-reuse-"));
  const workspace = path.join(directory, "workspace");
  const stateRoot = path.join(directory, "state");
  fs.mkdirSync(workspace);
  const sentinel = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], {
    stdio: "ignore", windowsHide: true,
  });
  try {
    const { workspaceScopeDir } = jobModule;
    const scope = workspaceScopeDir(fs.realpathSync.native(workspace), { "state-root": stateRoot });
    const id = "codex-stale-pid-reuse";
    const jobDir = path.join(scope, id);
    fs.mkdirSync(jobDir, { recursive: true });
    const artifacts = {
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
    const ownerToken = "sentinel-owner-token";
    fs.writeFileSync(artifacts.owner, `${JSON.stringify({
      version: 1,
      job_id: id,
      owner_token: ownerToken,
      runner_pid: sentinel.pid,
    })}\n`, "utf8");
    fs.writeFileSync(artifacts.manifest, `${JSON.stringify({
      version: 1,
      id,
      title: "PID reuse sentinel",
      created_at: new Date().toISOString(),
      workspace: fs.realpathSync.native(workspace),
      heartbeat_ms: 50,
      runner_pid: sentinel.pid,
      owner_token: ownerToken,
      artifacts,
    }, null, 2)}\n`, "utf8");

    const cancellation = jsonCli([
      "cancel", id, "--workspace", workspace, "--state-root", stateRoot,
      "--timeout-ms", "100", "--poll-ms", "25", "--json",
    ]);
    assert.equal(cancellation.timed_out, true);
    assert.equal(cancellation.job.status, "cancelling");
    assert.equal(pidAlive(sentinel.pid), true, "controller must not signal the manifest PID");
  } finally {
    sentinel.kill();
  }
});

test("status ignores an early telemetry success unless a durable terminal record exists", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "lask-codex-job-terminal-commit-"));
  const workspace = path.join(directory, "workspace");
  const stateRoot = path.join(directory, "state");
  fs.mkdirSync(workspace);
  const { workspaceScopeDir } = jobModule;
  const scope = workspaceScopeDir(fs.realpathSync.native(workspace), { "state-root": stateRoot });
  const id = "codex-uncommitted-success";
  const jobDir = path.join(scope, id);
  fs.mkdirSync(jobDir, { recursive: true });
  const artifacts = {
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
  const ownerToken = "dead-owner-token";
  fs.writeFileSync(artifacts.owner, `${JSON.stringify({
    version: 1,
    job_id: id,
    owner_token: ownerToken,
    runner_pid: 2147483647,
  })}\n`, "utf8");
  fs.writeFileSync(artifacts.events, `${JSON.stringify({ type: "turn.completed" })}\n`, "utf8");
  fs.writeFileSync(artifacts.telemetry, [
    JSON.stringify({ type: "runner.started", runner_pid: 2147483647, child_pid: 2147483647 }),
    JSON.stringify({ type: "runner.completed", exit_code: 0 }),
    "",
  ].join("\n"), "utf8");
  fs.writeFileSync(artifacts.stderr, "", "utf8");
  fs.writeFileSync(artifacts.final, "UNCOMMITTED_FINAL", "utf8");
  fs.writeFileSync(artifacts.manifest, `${JSON.stringify({
    version: 1,
    id,
    title: "Uncommitted terminal",
    created_at: new Date(Date.now() - 20_000).toISOString(),
    workspace: fs.realpathSync.native(workspace),
    heartbeat_ms: 50,
    runner_pid: null,
    owner_token: ownerToken,
    artifacts,
  }, null, 2)}\n`, "utf8");

  const status = jsonCli([
    "status", id, "--workspace", workspace, "--state-root", stateRoot, "--json",
  ]);
  assert.equal(status.job.status, "stale");
  const result = runCli(["result", id, "--workspace", workspace, "--state-root", stateRoot, "--json"]);
  assert.equal(result.status, 4);
  const resultPayload = JSON.parse(result.stdout);
  assert.equal(resultPayload.job.status, "stale");
  assert.equal(resultPayload.result, "");
  assert.doesNotMatch(result.stdout, /UNCOMMITTED_FINAL/);
});

test("workspaces are isolated and concurrent starts do not race on shared registry state", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "lask-codex-job-scope-"));
  const workspaceA = path.join(directory, "workspace-a");
  const workspaceB = path.join(directory, "workspace-b");
  const stateRoot = path.join(directory, "state");
  fs.mkdirSync(workspaceA);
  fs.mkdirSync(workspaceB);
  const fake = writeFakeCodex(directory);
  const prompt = path.join(directory, "prompt.md");
  fs.writeFileSync(prompt, "CONCURRENT", "utf8");

  const starts = await Promise.all([1, 2].map(() => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [JOB, ...baseStart({ prompt, workspace: workspaceA, stateRoot, fake })], {
      stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code) => code === 0 ? resolve(JSON.parse(stdout)) : reject(new Error(stderr)));
  })));
  assert.notEqual(starts[0].job.id, starts[1].job.id);
  const allA = jsonCli(["status", "--all", "--workspace", workspaceA, "--state-root", stateRoot, "--json"]);
  assert.equal(allA.jobs.length, 2);
  const allB = jsonCli(["status", "--all", "--workspace", workspaceB, "--state-root", stateRoot, "--json"]);
  assert.deepEqual(allB.jobs, []);
  for (const started of starts) {
    jsonCli([
      "status", started.job.id, "--workspace", workspaceA, "--state-root", stateRoot,
      "--wait", "--timeout-ms", "5000", "--poll-ms", "25", "--json",
    ]);
  }
});

test("wait timeout is observable without stopping the job", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "lask-codex-job-timeout-"));
  const workspace = path.join(directory, "workspace");
  const stateRoot = path.join(directory, "state");
  fs.mkdirSync(workspace);
  const fake = writeFakeCodex(directory);
  const prompt = path.join(directory, "prompt.md");
  fs.writeFileSync(prompt, "KEEP_RUNNING", "utf8");
  const started = jsonCli(baseStart({ prompt, workspace, stateRoot, fake, hold: 5000 }));
  const timed = runCli([
    "status", started.job.id, "--workspace", workspace, "--state-root", stateRoot,
    "--wait", "--timeout-ms", "100", "--poll-ms", "25", "--json",
  ]);
  assert.equal(timed.status, 124);
  const payload = JSON.parse(timed.stdout);
  assert.equal(payload.timed_out, true);
  assert.ok(["queued", "running"].includes(payload.job.status));
  jsonCli([
    "cancel", started.job.id, "--workspace", workspace, "--state-root", stateRoot,
    "--timeout-ms", "5000", "--poll-ms", "25", "--json",
  ]);
});

test("controller owns final-message injection and safely tokenizes slash-command arguments", () => {
  const { buildManagedCommand, normalizeForwardedArgs } = jobModule;
  assert.deepEqual(
    buildManagedCommand(["codex", "exec", "--json", "-"], "final.md"),
    ["codex", "exec", "--json", "--output-last-message", "final.md", "-"],
  );
  assert.throws(
    () => buildManagedCommand(["codex", "exec", "--json", "-o", "other.md", "-"], "final.md"),
    /owns --output-last-message/,
  );
  assert.deepEqual(
    normalizeForwardedArgs(["codex-123 --workspace 'C:\\A B' --json"]),
    ["codex-123", "--workspace", "C:\\A B", "--json"],
  );
  assert.deepEqual(normalizeForwardedArgs([""]), []);
});

test("job root ignores another plugin's CLAUDE_PLUGIN_DATA leaked into the session", () => {
  const { resolveJobRoot } = jobModule;
  const leaked = { CLAUDE_PLUGIN_DATA: path.join(os.tmpdir(), "some-other-plugin-data") };
  assert.equal(resolveJobRoot({}, leaked), path.join(os.tmpdir(), "lask-codex-jobs"));
  assert.equal(resolveJobRoot({}, { ...leaked, LASK_CODEX_JOB_ROOT: path.join(os.tmpdir(), "x") }), path.join(os.tmpdir(), "x"));
  assert.equal(resolveJobRoot({ "state-root": path.join(os.tmpdir(), "y") }, leaked), path.join(os.tmpdir(), "y"));
});
