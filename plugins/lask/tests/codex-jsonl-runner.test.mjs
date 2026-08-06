import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RUNNER = path.join(PLUGIN_ROOT, "scripts", "codex-jsonl-runner.mjs");

function waitForExit(child) {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({ code, signal }));
  });
}

async function waitFor(check, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = check();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("timed out waiting for test condition");
}

function writeFakeCodex(dir) {
  const fake = path.join(dir, "fake codex.mjs");
  fs.writeFileSync(fake, `
import fs from "node:fs";
import { spawn } from "node:child_process";
import process from "node:process";
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let prompt = "";
process.stdin.setEncoding("utf8");
for await (const chunk of process.stdin) prompt += chunk;
const exitArg = process.argv.find((arg) => arg.startsWith("--fake-exit="));
const exitCode = exitArg ? Number(exitArg.split("=")[1]) : 0;
const holdArg = process.argv.find((arg) => arg.startsWith("--fake-hold="));
const firstDelay = holdArg ? Number(holdArg.split("=")[1]) : 140;
const finalIndex = process.argv.indexOf("--output-last-message");
const finalPath = finalIndex >= 0 ? process.argv[finalIndex + 1] : null;
const descendantArg = process.argv.find((arg) => arg.startsWith("--fake-resistant-descendant="));
if (descendantArg) {
  const pidFile = descendantArg.slice("--fake-resistant-descendant=".length);
  const descendant = spawn(process.execPath, ["-e", "process.on('SIGTERM',()=>{});process.on('SIGINT',()=>{});setInterval(()=>{},1000)"], {stdio:"ignore"});
  fs.writeFileSync(pidFile, String(descendant.pid));
}
process.stdout.write(JSON.stringify({type:"thread.started",thread_id:"fake-thread"}) + "\\n");
if (process.argv.includes("--fake-invalid")) process.stdout.write("NOT_JSON\\n");
if (process.argv.includes("--fake-active-only")) {
  for (let index = 0; index < 12; index += 1) {
    await delay(20);
    process.stdout.write(JSON.stringify({type:"item.started",item:{id:String(index),type:"command_execution",command:"active"}}) + "\\n");
  }
  process.stdout.write(JSON.stringify({type:"turn.completed",usage:{output_tokens:3}}) + "\\n");
  fs.writeFileSync(finalPath, prompt, "utf8");
} else {
  await delay(firstDelay);
  process.stdout.write(JSON.stringify({type:"item.started",item:{id:"item-1",type:"command_execution",command:"fake-check"}}) + "\\n");
  await delay(140);
  process.stderr.write("FAKE_STDERR\\n");
  process.stdout.write(JSON.stringify({type:"item.completed",item:{id:"item-2",type:"agent_message",text:prompt}}) + "\\n");
  process.stdout.write(JSON.stringify({type:exitCode ? "turn.failed" : "turn.completed",usage:{output_tokens:3}}) + "\\n");
  if (exitCode === 0 && finalPath && !process.argv.includes("--fake-no-final"))
    fs.writeFileSync(finalPath, prompt, "utf8");
  process.exitCode = exitCode;
}
`, "utf8");
  return fake;
}

function pathsFor(dir) {
  return {
    prompt: path.join(dir, "review prompt.md"),
    events: path.join(dir, "review events.jsonl"),
    telemetry: path.join(dir, "runner telemetry.jsonl"),
    stderr: path.join(dir, "review stderr.log"),
    final: path.join(dir, "final message.md"),
  };
}

function runnerArgs(paths, fake, extra = []) {
  return [
    RUNNER,
    "--prompt", paths.prompt,
    "--events", paths.events,
    "--telemetry", paths.telemetry,
    "--stderr", paths.stderr,
    "--heartbeat-ms", "50",
    "--",
    process.execPath, fake, "--json",
    "--output-last-message", paths.final,
    ...extra,
  ];
}

test("runner streams events before completion, emits quiet heartbeats, and separates artifacts", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lask codex runner "));
  const paths = pathsFor(dir);
  const fake = writeFakeCodex(dir);
  const exactPrompt = "TRY_TO_REFUTE\ntrailing spaces  \n";
  fs.writeFileSync(paths.prompt, exactPrompt, "utf8");

  const child = spawn(process.execPath, runnerArgs(paths, fake), {
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let firstEventArrivedWhileRunning = false;
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
    if (chunk.includes("thread.started") && child.exitCode === null)
      firstEventArrivedWhileRunning = true;
  });
  const result = await waitForExit(child);

  assert.equal(result.code, 0);
  assert.equal(firstEventArrivedWhileRunning, true, "first Codex event must be visible before completion");
  assert.match(stdout, /thread\.started/);
  assert.match(stdout, /heartbeat/i, "a quiet interval must prove the process is alive");
  const parsed = fs.readFileSync(paths.events, "utf8").trim().split(/\r?\n/).map(JSON.parse);
  assert.deepEqual(parsed.map((event) => event.type), [
    "thread.started", "item.started", "item.completed", "turn.completed",
  ]);
  assert.equal(parsed[2].item.text, exactPrompt, "prompt bytes must reach child stdin without trimming");
  assert.equal(fs.readFileSync(paths.final, "utf8"), exactPrompt);
  assert.equal(fs.readFileSync(paths.stderr, "utf8"), "FAKE_STDERR\n");
  const telemetry = fs.readFileSync(paths.telemetry, "utf8").trim().split(/\r?\n/).map(JSON.parse);
  assert.equal(telemetry[0].type, "runner.started");
  assert.ok(telemetry.some((record) => record.type === "heartbeat"));
  assert.equal(telemetry.at(-1).type, "runner.completed");
  assert.equal(telemetry.at(-1).exit_code, 0);
});

test("runner propagates a failing Codex exit and retains that attempt's artifacts", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lask-codex-runner-fail-"));
  const paths = pathsFor(dir);
  const fake = writeFakeCodex(dir);
  fs.writeFileSync(paths.prompt, "FAIL_CASE", "utf8");

  const child = spawn(process.execPath, runnerArgs(paths, fake, ["--fake-exit=7"]), {
    stdio: "ignore",
  });
  const result = await waitForExit(child);

  assert.equal(result.code, 7, "logging must not turn a Codex failure into success");
  const types = fs.readFileSync(paths.events, "utf8").trim().split(/\r?\n/).map((line) => JSON.parse(line).type);
  assert.equal(types.at(-1), "turn.failed");
  assert.equal(fs.existsSync(paths.final), false, "failed child need not claim a final response");
  const telemetry = fs.readFileSync(paths.telemetry, "utf8").trim().split(/\r?\n/).map(JSON.parse);
  assert.equal(telemetry.at(-1).type, "runner.failed");
  assert.equal(telemetry.at(-1).exit_code, 7);
});

test("runner fails closed on malformed stdout without corrupting the JSONL artifact", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lask-codex-runner-invalid-"));
  const paths = pathsFor(dir);
  const fake = writeFakeCodex(dir);
  fs.writeFileSync(paths.prompt, "INVALID_CASE", "utf8");
  const child = spawn(process.execPath, runnerArgs(paths, fake, ["--fake-invalid", "--fake-hold=5000"]), {
    stdio: ["ignore", "ignore", "pipe"],
  });
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const result = await waitForExit(child);

  assert.equal(result.code, 74);
  assert.match(stderr, /invalid Codex JSONL stdout/);
  const events = fs.readFileSync(paths.events, "utf8").trim().split(/\r?\n/).map(JSON.parse);
  assert.deepEqual(events.map((event) => event.type), ["thread.started"]);
});

test("heartbeats are suppressed while Codex events remain active", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lask-codex-runner-active-"));
  const paths = pathsFor(dir);
  const fake = writeFakeCodex(dir);
  fs.writeFileSync(paths.prompt, "ACTIVE_CASE", "utf8");
  const child = spawn(process.execPath, runnerArgs(paths, fake, ["--fake-active-only"]), {
    stdio: "ignore",
  });
  const result = await waitForExit(child);

  assert.equal(result.code, 0);
  const telemetry = fs.readFileSync(paths.telemetry, "utf8").trim().split(/\r?\n/).map(JSON.parse);
  assert.equal(
    telemetry.some((record) => record.type === "heartbeat" && record.last_event === "item.started"),
    false,
    "an unconditional timer would emit heartbeats while the active item stream is resetting the quiet deadline",
  );
  assert.equal(telemetry.at(-1).type, "runner.completed");
});

test("closed runner stdout terminates the child instead of orphaning it", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lask-codex-runner-epipe-"));
  const paths = pathsFor(dir);
  const fake = writeFakeCodex(dir);
  fs.writeFileSync(paths.prompt, "EPIPE_CASE", "utf8");
  const child = spawn(process.execPath, runnerArgs(paths, fake, ["--fake-hold=5000"]), {
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.destroy();
  const result = await waitForExit(child);

  assert.equal(result.code, 74);
  assert.equal(fs.existsSync(paths.final), false);
  const telemetry = fs.readFileSync(paths.telemetry, "utf8").trim().split(/\r?\n/).map(JSON.parse);
  const childPid = telemetry[0].child_pid;
  await waitFor(() => {
    try { process.kill(childPid, 0); return false; } catch { return true; }
  });
});

test("runner refuses to overwrite artifacts from an earlier attempt", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lask-codex-runner-existing-"));
  const paths = pathsFor(dir);
  const fake = writeFakeCodex(dir);
  fs.writeFileSync(paths.prompt, "NEW_ATTEMPT", "utf8");
  fs.writeFileSync(paths.events, "PRIOR_ATTEMPT\n", "utf8");
  const child = spawn(process.execPath, runnerArgs(paths, fake), {
    stdio: ["ignore", "ignore", "pipe"],
  });
  const result = await waitForExit(child);

  assert.equal(result.code, 2);
  assert.equal(fs.readFileSync(paths.events, "utf8"), "PRIOR_ATTEMPT\n");
  assert.equal(fs.existsSync(paths.final), false);
});

test("runner rejects zero-exit child that omitted the final-message artifact", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lask-codex-runner-no-final-"));
  const paths = pathsFor(dir);
  const fake = writeFakeCodex(dir);
  fs.writeFileSync(paths.prompt, "NO_FINAL", "utf8");
  const child = spawn(process.execPath, runnerArgs(paths, fake, ["--fake-no-final"]), {
    stdio: "ignore",
  });
  const result = await waitForExit(child);
  assert.equal(result.code, 66);
});

test("runner rejects a command that forgot Codex JSONL mode", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lask-codex-runner-no-json-"));
  const paths = pathsFor(dir);
  fs.writeFileSync(paths.prompt, "NO_JSON", "utf8");
  const child = spawn(process.execPath, [
    RUNNER,
    "--prompt", paths.prompt,
    "--events", paths.events,
    "--telemetry", paths.telemetry,
    "--stderr", paths.stderr,
    "--",
    process.execPath, "-e", "process.exit(0)",
  ], { stdio: ["ignore", "pipe", "pipe"] });
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const result = await waitForExit(child);
  assert.notEqual(result.code, 0);
  assert.match(stderr, /--json/);
});

test("runner reports an immediate spawn failure without hanging", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lask-codex-runner-spawn-"));
  const paths = pathsFor(dir);
  fs.writeFileSync(paths.prompt, "SPAWN_FAILURE", "utf8");
  const missing = path.join(dir, "missing-executable.exe");
  const child = spawn(process.execPath, [
    RUNNER,
    "--prompt", paths.prompt,
    "--events", paths.events,
    "--telemetry", paths.telemetry,
    "--stderr", paths.stderr,
    "--",
    missing, "--json", "--output-last-message", paths.final,
  ], { stdio: "ignore" });
  const result = await waitForExit(child);

  assert.equal(result.code, 127);
  const telemetry = fs.readFileSync(paths.telemetry, "utf8").trim().split(/\r?\n/).map(JSON.parse);
  assert.equal(telemetry.at(-1).type, "runner.failed");
  assert.equal(telemetry.at(-1).exit_code, 127);
});

test("runner forwards termination to the active POSIX process group", { skip: process.platform === "win32" }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lask-codex-runner-signal-"));
  const paths = pathsFor(dir);
  const fake = writeFakeCodex(dir);
  const descendantPidFile = path.join(dir, "descendant.pid");
  fs.writeFileSync(paths.prompt, "SIGNAL_CASE", "utf8");
  const args = runnerArgs(paths, fake, [
    "--fake-hold=5000", `--fake-resistant-descendant=${descendantPidFile}`,
  ]);
  const child = spawn(process.execPath, args, { stdio: ["ignore", "pipe", "pipe"] });

  await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      if (chunk.includes("thread.started")) resolve();
    });
  });
  const descendantPid = await waitFor(() => {
    if (!fs.existsSync(descendantPidFile)) return null;
    return Number(fs.readFileSync(descendantPidFile, "utf8"));
  });
  child.kill("SIGTERM");
  child.kill("SIGTERM");
  const result = await waitForExit(child);
  assert.equal(result.code, 143);
  const types = fs.readFileSync(paths.events, "utf8").trim().split(/\r?\n/).map((line) => JSON.parse(line).type);
  assert.deepEqual(types, ["thread.started"]);
  await waitFor(() => {
    try { process.kill(descendantPid, 0); return false; } catch { return true; }
  });
});

test("Windows resolver launches the native Codex binary, not an npm shim", { skip: process.platform !== "win32" }, async () => {
  const { resolveCommand } = await import(pathToFileURL(RUNNER));
  const resolved = resolveCommand("codex", ["exec"]);
  assert.match(resolved.executable, /codex\.exe$/i);
  assert.doesNotMatch(resolved.executable, /codex\.js$/i);
});

test("Windows resolver supports project-local node_modules/.bin layout", { skip: process.platform !== "win32" }, async () => {
  const { resolveCommand } = await import(pathToFileURL(RUNNER));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lask-codex-local-layout-"));
  const shimDir = path.join(dir, "node_modules", ".bin");
  const arch = process.arch === "arm64" ? "arm64" : "x64";
  const target = process.arch === "arm64" ? "aarch64-pc-windows-msvc" : "x86_64-pc-windows-msvc";
  const native = path.join(dir, "node_modules", "@openai", "codex", "node_modules", "@openai",
    `codex-win32-${arch}`, "vendor", target, "bin", "codex.exe");
  fs.mkdirSync(shimDir, { recursive: true });
  fs.mkdirSync(path.dirname(native), { recursive: true });
  fs.writeFileSync(path.join(shimDir, "codex.ps1"), "# fixture", "utf8");
  fs.writeFileSync(native, "fixture", "utf8");

  const resolved = resolveCommand(path.join(shimDir, "codex.cmd"), ["exec"]);
  assert.equal(path.resolve(resolved.executable), path.resolve(native));
});

test("Windows tree termination kills descendants", { skip: process.platform !== "win32" }, async () => {
  const { terminateProcessTree } = await import(pathToFileURL(RUNNER));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lask-codex-runner-tree-"));
  const pidFile = path.join(dir, "grandchild.pid");
  const parentScript = path.join(dir, "parent.mjs");
  fs.writeFileSync(parentScript, `
import { spawn } from "node:child_process";
import fs from "node:fs";
import process from "node:process";
const grandchild = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {stdio:"ignore"});
fs.writeFileSync(process.argv[2], String(grandchild.pid));
setInterval(() => {}, 1000);
`, "utf8");
  const parent = spawn(process.execPath, [parentScript, pidFile], { stdio: "ignore" });
  const grandchildPid = await waitFor(() => {
    if (!fs.existsSync(pidFile)) return null;
    return Number(fs.readFileSync(pidFile, "utf8"));
  });
  terminateProcessTree(parent, "SIGTERM");
  await waitForExit(parent);
  await waitFor(() => {
    try { process.kill(grandchildPid, 0); return false; } catch { return true; }
  });
});

test("PowerShell 7 pipeline preserves UTF-8 and propagates native, tee, and overwrite failures", { skip: process.platform !== "win32" }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lask-portable-powershell-"));
  const script = path.join(dir, "pipeline.ps1");
  const prompt = path.join(dir, "prompt.md");
  fs.writeFileSync(prompt, "繁體中文", "utf8");
  fs.writeFileSync(script, `
param([string]$Mode,[string]$Base,[string]$Prompt)
$ErrorActionPreference='Stop'
$PSNativeCommandUseErrorActionPreference=$false
$OutputEncoding=[Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
$events=if($Mode -eq 'tee-fail'){Join-Path "$Base-missing" 'events.jsonl'}else{"$Base-events.jsonl"}
$stderr="$Base-stderr.log"
$final="$Base-final.md"
if($Mode -eq 'existing'){[IO.File]::WriteAllText($events,'PRIOR',[Text.UTF8Encoding]::new($false))}
$artifacts=@($events,$stderr,$final)
foreach($artifact in $artifacts){if(Test-Path -LiteralPath $artifact){throw "refusing to overwrite $artifact"}}
$env:FINAL_OUT=$final
$wanted=if($Mode -eq 'native-fail'){7}else{0}
Get-Content -Raw -Encoding utf8 $Prompt | & node -e 'let s="";process.stdin.setEncoding("utf8");process.stdin.on("data",c=>s+=c);process.stdin.on("end",()=>{console.log(JSON.stringify({type:"turn.completed",text:s}));if(Number(process.argv[1])===0)require("fs").writeFileSync(process.env.FINAL_OUT,"FINAL");process.exit(Number(process.argv[1]))})' $wanted 2> $stderr | Tee-Object -FilePath $events
$codexExit=$LASTEXITCODE
if($null -eq $codexExit){exit 127}
if($codexExit -ne 0){exit $codexExit}
if(-not (Test-Path -LiteralPath $final -PathType Leaf) -or (Get-Item -LiteralPath $final).Length -eq 0){exit 66}
$rows=@(Get-Content -Encoding utf8 $events | ForEach-Object {$_ | ConvertFrom-Json -ErrorAction Stop})
if($rows.Count -ne 1 -or $rows[0].type -ne 'turn.completed'){exit 9}
`, "utf8");

  const run = (mode) => spawnSync("pwsh.exe", [
    "-NoProfile", "-File", script, mode, path.join(dir, mode), prompt,
  ], {
    encoding: "utf8",
    shell: false,
    windowsHide: true,
  });
  assert.equal(run("success").status, 0);
  const successEvent = JSON.parse(fs.readFileSync(path.join(dir, "success-events.jsonl"), "utf8").trim());
  assert.equal(successEvent.text.trim(), "繁體中文");
  assert.equal(run("native-fail").status, 7);
  assert.notEqual(run("tee-fail").status, 0);
  assert.notEqual(run("existing").status, 0);
});
