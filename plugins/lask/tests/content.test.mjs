import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function read(rel) {
  return fs.readFileSync(path.join(PLUGIN_ROOT, rel), "utf8");
}

// Minimal frontmatter parser: only what our own files use (string values, one level).
export function parseFrontmatter(src) {
  const m = src.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  assert.ok(m, "file must start with a --- frontmatter block");
  const fm = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z-]+):\s*(.*)$/);
    if (kv) fm[kv[1]] = kv[2].trim();
  }
  return { fm, body: m[2] };
}

const AGENTS = [
  "scout",
  "researcher",
  "implementer",
  "debugger",
  "verifier",
  "reviewer",
  "second-opinion",
  "codex-implementer",
];

test("agents directory contains exactly the eight roster agents", () => {
  const files = fs.readdirSync(path.join(PLUGIN_ROOT, "agents")).sort();
  assert.deepEqual(files, AGENTS.map((a) => `${a}.md`).sort());
});

test("every agent has sound frontmatter and the shared contracts", () => {
  for (const name of AGENTS) {
    const { fm, body } = parseFrontmatter(read(`agents/${name}.md`));
    assert.equal(fm.name, name, `${name}: frontmatter name must match filename`);
    assert.ok(fm.description && fm.description.length >= 40, `${name}: description too short to guide dispatch`);
    assert.ok(["sonnet", "opus"].includes(fm.model), `${name}: model must be sonnet or opus, never fable`);
    assert.match(body, /## Report protocol/, `${name}: must embed the report protocol`);
    assert.match(body, /path:line/, `${name}: must state the clickable path:line rule`);
    assert.match(body, /## Verdict/, `${name}: report must lead with a Verdict section`);
    assert.match(body, /Open questions/, `${name}: report must surface open questions`);
  }
});

test("tool restrictions match each agent's mandate", () => {
  const tools = Object.fromEntries(
    AGENTS.map((a) => [a, parseFrontmatter(read(`agents/${a}.md`)).fm.tools]),
  );
  assert.equal(tools["scout"], "Read, Glob, Grep, Bash");
  assert.equal(tools["researcher"], "Read, Glob, Grep, WebSearch, WebFetch, ToolSearch");
  assert.equal(tools["verifier"], "Read, Glob, Grep, Bash");
  assert.equal(tools["reviewer"], "Read, Glob, Grep, Bash");
  assert.equal(tools["second-opinion"], "Bash, Read");
  assert.equal(tools["codex-implementer"], "Bash, Read, Glob, Grep");
  assert.equal(tools["implementer"], undefined, "implementer needs the full toolset");
  assert.equal(tools["debugger"], undefined, "debugger needs the full toolset");
});

test("read-only agents forbid mutation and the builder/grader split holds", () => {
  for (const name of ["scout", "researcher", "reviewer", "verifier"]) {
    assert.match(read(`agents/${name}.md`), /[Nn]ever (create, modify, or delete|modify)/, `${name}: must state read-only discipline`);
  }
  assert.match(read("agents/verifier.md"), /never fix/i);
  assert.match(read("agents/implementer.md"), /self-test/i);
  assert.match(read("agents/debugger.md"), /revert/i);
});

test("second-opinion embeds the verified codex recipe and the no-substitute rule", () => {
  const src = read("agents/second-opinion.md");
  assert.match(src, /codex-job\.mjs/, "must use the observable job controller");
  assert.match(src, /codex exec --sandbox read-only --skip-git-repo-check --color never/);
  assert.match(src, /--json/, "must request live JSONL events");
  assert.match(src, /job ID/i, "must surface a stable job handle");
  assert.match(src, /codex-status/, "must document status UX");
  assert.match(src, /codex-result/, "must document result UX");
  assert.match(src, /--prompt/, "runner must pipe the prompt file to stdin");
  assert.match(src, /never as a shell argument/i);
  assert.match(src, /never substitute/i);
  assert.match(src, /no adoption decisions/i);
  assert.match(src, /heartbeat/i, "must explain quiet-period liveness");
});

test("codex-implementer pins the sol/xhigh recipe and the rate-limit guard", () => {
  const src = read("agents/codex-implementer.md");
  assert.match(src, /codex exec -m gpt-5\.6-sol/, "must pin the model");
  assert.match(src, /model_reasoning_effort="xhigh"/, "must default to xhigh effort");
  assert.match(src, /--sandbox workspace-write/, "write mode is the whole point");
  assert.match(src, /codex-job\.mjs/, "must use the observable job controller");
  assert.match(src, /--json/, "must request live JSONL events");
  assert.match(src, /job ID/i, "must surface a stable job handle");
  assert.match(src, /codex-status/, "must document status UX");
  assert.match(src, /codex-result/, "must document result UX");
  assert.match(src, /--prompt/, "runner must pipe the prompt file to stdin");
  assert.match(src, /never as a shell argument/i);
  assert.match(src, /already detached/i, "must explain that start is already backgrounded");
  assert.match(src, /resets_at/, "rate-limit reader must key off the real resets_at field");
  assert.match(src, /remaining < 20/, "must state the 20%-remaining warn threshold");
  assert.match(src, /BEFORE and AFTER/i, "must check limits on both sides of the run");
  assert.match(src, /never (?:silently )?substitute/i, "the 400 sol error must not trigger a silent model swap");
  assert.match(src, /limits unknown/i, "must degrade gracefully when no snapshot exists");
  assert.match(src, /require\('node:fs'\)/, "rate-limit reader must be an embedded Node script, self-contained");
});

test("all frontmatter stays strict-YAML-safe (no unquoted colon-space in values)", () => {
  const files = [
    ...fs.readdirSync(path.join(PLUGIN_ROOT, "agents")).map((f) => `agents/${f}`),
    ...fs.readdirSync(path.join(PLUGIN_ROOT, "skills")).map((d) => `skills/${d}/SKILL.md`),
  ].filter((f) => fs.existsSync(path.join(PLUGIN_ROOT, f)));
  for (const f of files) {
    const { fm } = parseFrontmatter(read(f));
    for (const [k, v] of Object.entries(fm)) {
      if (/^["']/.test(v)) continue; // quoted scalars may contain anything
      assert.ok(!/:\s/.test(v), `${f}: frontmatter '${k}' contains unquoted ': ' — breaks strict YAML parsers (GitHub). Quote the value or rephrase.`);
    }
  }
});

test("codex-run skill ships the verified model×effort table and the mechanical protocol", () => {
  const { fm, body } = parseFrontmatter(read("skills/codex-run/SKILL.md"));
  assert.equal(fm.name, "codex-run");
  assert.match(fm.description, /explicitly/i, "must be manual-dispatch only, not auto-triggered ambition");
  assert.ok(fm["argument-hint"], "must ship an argument-hint for the command picker");
  assert.match(fm["argument-hint"], /--model/, "argument-hint must surface --model");
  assert.match(fm["argument-hint"], /--effort/, "argument-hint must surface --effort");
  assert.match(body, /## Arguments/, "must document the flag parsing table");
  for (const m of ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"]) {
    assert.match(body, new RegExp(m.replace(/\./g, "\\.")), `table must list ${m}`);
  }
  assert.match(body, /minimal.*(400|unsupported)/is, "must document that minimal is rejected by all three models");
  assert.match(body, /codex-job\.mjs/, "must use the observable job controller");
  assert.match(body, /--prompt/, "runner must pipe the prompt file to stdin");
  assert.match(body, /--json/, "must request live JSONL events");
  assert.match(body, /job ID/i, "must surface a stable job handle");
  assert.match(body, /codex-status/, "must document status UX");
  assert.match(body, /codex-result/, "must document result UX");
  assert.match(body, /--output-last-message/);
  assert.match(body, /Never add `--dangerously-bypass/i, "the dangerous bypass flag must appear only as a prohibition");
  assert.match(body, /at capacity/i, "capacity error must be documented as transient");
  assert.match(body, /NEVER silently substitute/i, "model substitution stays a user/director decision");
  assert.match(body, /127\.0\.0\.1:8080/, "known MCP noise must be documented as ignorable");
  assert.match(body, /verbatim/i, "relay must be faithful");
});

test("director skill exists, names the whole roster, and keeps the escape hatch documented", () => {
  const { fm, body } = parseFrontmatter(read("skills/director/SKILL.md"));
  assert.equal(fm.name, "director");
  assert.ok(fm.description && fm.description.length >= 60);
  for (const a of AGENTS) assert.match(body, new RegExp(`lask:${a}`), `director skill must name lask:${a}`);
  assert.match(body, /tier: reviewed/);
  assert.match(body, /acceptance criteria/i);
  assert.match(body, /path:line/);
  assert.match(body, /adjudicat/i, "must state the per-finding adjudication duty");
});

test("delegation-playbooks skill covers the five scenarios and the cross-model checkpoint", () => {
  const { fm, body } = parseFrontmatter(read("skills/delegation-playbooks/SKILL.md"));
  assert.equal(fm.name, "delegation-playbooks");
  assert.ok(fm.description && fm.description.length >= 60);
  for (const s of ["## Feature", "## Bugfix", "## Research", "## Refactor", "## Review"])
    assert.match(body, new RegExp(s), `playbooks must cover ${s}`);
  assert.match(body, /second-opinion/);
  assert.match(body, /escalat/i);
});

test("model-tiers is retired and handoff survives", () => {
  assert.ok(!fs.existsSync(path.join(PLUGIN_ROOT, "skills", "model-tiers")), "model-tiers must be deleted");
  assert.ok(fs.existsSync(path.join(PLUGIN_ROOT, "skills", "handoff", "SKILL.md")));
});

test("fable-sense ships the conditions discipline with its evidence and adapters", () => {
  const { fm, body } = parseFrontmatter(read("skills/fable-sense/SKILL.md"));
  assert.equal(fm.name, "fable-sense");
  assert.ok(fm.description && fm.description.length >= 60, "description too short to trigger reliably");
  assert.match(fm.description, /^Use when /, "description must state triggering conditions, not workflow");
  assert.match(fm.description, /Not for mechanical tasks/, "description must carry the skip-gate");
  assert.match(fm.description, /already running on Fable/, "description must exempt Fable sessions (the sense is native)");
  assert.match(body, /already running on Fable/, "body must carry the Fable exemption");
  for (const field of ["TASK:", "REAL GOAL:", "DELIVERABLE:", "STAKES:", "CONSTRAINTS:", "EVIDENCE FIRST:"])
    assert.match(body, new RegExp(field), `brief template must include ${field}`);
  assert.match(body, /codex exec --sandbox read-only/, "Claude->Codex tail guard must embed the verified recipe");
  assert.match(body, /codex-job\.mjs/, "Claude-side tail guard must use the observable job controller");
  assert.match(body, /do NOT shell out to `claude -p`/, "Codex-side tail guard must prohibit claude -p (retired: fails/times out in Codex sessions)");
  assert.match(body, /10 minutes/, "must carry the measured timeout guidance");
  assert.match(body, /Skip this skill entirely/, "quick reference must keep the mechanical-task skip row");
  assert.ok(fs.existsSync(path.join(PLUGIN_ROOT, "skills", "fable-sense", "codex-agents-block.md")), "codex adapter must ship");
  assert.ok(fs.existsSync(path.join(PLUGIN_ROOT, "skills", "fable-sense", "eval", "RUBRICS.md")), "pre-registered rubrics must ship for re-validation");
  assert.ok(fs.existsSync(path.join(PLUGIN_ROOT, "skills", "fable-sense", "eval", "results", "grades.md")), "graded evidence must ship");
  const block = read("skills/fable-sense/codex-agents-block.md");
  for (const src of [body, block]) {
    assert.doesNotMatch(src, /--output-format stream-json/, "retired Codex->Claude streaming recipe must be gone");
    assert.match(src, /--output-last-message/, "tail guard must collect the review from the output-last-message file");
    assert.match(src, /--json/, "tail guard must stream Codex events as JSONL");
    assert.match(src, /\.jsonl/, "tail guard must preserve a JSONL event artifact");
  }
  assert.match(body, /heartbeat/i, "Claude-side runner must surface quiet-period liveness");
  assert.match(body, /codex-status/, "Claude-side job UX must expose status");
  assert.match(body, /codex-result/, "Claude-side job UX must expose result");
  assert.match(body, /codex-cancel/, "Claude-side job UX must expose cancellation");
  assert.match(block, /set -o pipefail/, "portable Codex block must preserve codex failures through tee");
  assert.match(block, /tee/, "portable Codex block must show and save live events");
  assert.match(block, /review-attempt1-stderr\.log/, "portable commands must preserve stderr separately");
  assert.match(block, /\$LASTEXITCODE/, "PowerShell pipeline must propagate Codex failure through Tee-Object");
  assert.match(block, /PowerShell 7\+/, "portable recipe must reject Windows PowerShell 5.1 transcoding semantics");
  assert.match(block, /ErrorActionPreference='Stop'/, "PowerShell pipeline must fail when Tee-Object cannot write");
  assert.match(block, /\[Console\]::OutputEncoding/, "headless PowerShell must explicitly encode native stdin as UTF-8");
  assert.match(block, /ConvertFrom-Json/, "PowerShell pipeline must validate the saved JSONL after completion");
  assert.match(block, /Bash \(not plain/, "pipefail recipe must not be advertised as POSIX sh");
  assert.match(block, /\[ -e "\$f" \].*\[ -L "\$f" \]/, "Bash recipe must refuse existing files and symlinks");
  assert.match(block, /test -s/, "Bash recipe must require a fresh non-empty final message");
  assert.match(block, /Test-Path -LiteralPath \$artifact/, "PowerShell recipe must refuse existing attempt artifacts");
  assert.match(block, /PathType Leaf/, "PowerShell recipe must require a fresh final-message file");
  assert.doesNotMatch(block, /2>&1/, "stderr must not corrupt the JSONL event file");
  assert.match(block, /codex exec --sandbox read-only/, "codex block tail guard must run a fresh codex exec");
  assert.match(block, /do\s+NOT shell out to `claude -p`/i, "codex block must carry the claude -p prohibition");
  assert.match(block, /BEGIN FABLE-SENSE/, "codex block must be marker-delimited for clean install/uninstall");
  assert.match(block, /skip this entirely/i, "codex block must carry the skip-gate");
  for (const src of [body, block]) {
    assert.match(src, /permuted/i, "1.4.2 benchmark clause: permuted verification for order/state bugs");
    assert.match(src, /runnable computation|runnable provenance/i, "1.4.2 benchmark clause: analysis ships its computation");
    assert.match(src, /adjacent hazard/i, "1.4.2 benchmark clause: name adjacent hazards");
  }
  assert.ok(fs.existsSync(path.join(PLUGIN_ROOT, "skills", "fable-sense", "eval", "bench", "bench-grades.md")), "5-arm benchmark evidence must ship");
  const readme = read("skills/fable-sense/README.md");
  assert.match(readme, /~\/\.codex\/skills\/fable-sense/, "README must document the Codex skills-dir install");
  assert.match(readme, /auto-trigger/i, "README must record why the AGENTS.md block stays (measured trigger unreliability)");
});

test("director-context.js source carries the policy tag and full roster", () => {
  const src = read("hooks/scripts/director-context.js");
  assert.match(src, /<lask-director-policy>/);
  for (const a of AGENTS) assert.match(src, new RegExp(`lask:${a}`));
  assert.match(src, /lask:delegation-playbooks/);
  assert.ok(!fs.existsSync(path.join(PLUGIN_ROOT, "hooks", "scripts", "tier-context.js")), "old context script must be gone");
});

test("plugin.json is 1.8.0 and describes director mode and fable-sense", () => {
  const pkg = JSON.parse(read(".claude-plugin/plugin.json"));
  assert.equal(pkg.name, "lask");
  assert.equal(pkg.version, "1.8.0");
  assert.match(pkg.description, /director/i);
  assert.match(pkg.description, /fable-sense/);
});

test("codex JSONL runner is cross-platform, observable, and exit-code safe", () => {
  const rel = "scripts/codex-jsonl-runner.mjs";
  assert.ok(fs.existsSync(path.join(PLUGIN_ROOT, rel)), "runner script must ship with the plugin");
  const src = read(rel);
  assert.match(src, /spawn\(/, "runner must launch Codex without a shell pipeline");
  assert.match(src, /shell:\s*false/, "shell interpolation must stay disabled");
  assert.match(src, /heartbeat/i, "runner must emit liveness heartbeats");
  assert.match(src, /JSON\.parse/, "runner must understand and summarize JSONL events");
  assert.match(src, /process\.exitCode/, "runner must propagate the Codex exit code");
  assert.match(src, /codex-win32-/, "runner must resolve the native Windows package");
  assert.match(src, /taskkill\.exe/, "Windows cancellation must terminate the full process tree");
  assert.match(src, /detached:\s*process\.platform !== "win32"/, "POSIX cancellation must own a process group");
  assert.match(src, /invalid Codex JSONL stdout/, "runner must fail closed on malformed child stdout");
  assert.match(src, /fs\.openSync\(file, "wx"\)/, "runner must refuse to overwrite earlier attempt evidence");
  assert.match(src, /--output-last-message/, "runner must require the final response artifact");
  assert.match(src, /runner\.cancelled/, "runner must acknowledge job cancellation");
  assert.match(src, /runner\.cancel\.ignored/, "invalid cross-job requests must not terminate the child");
  assert.match(src, /job_id/, "runner telemetry must carry the job identity");
  assert.match(src, /terminalFile/, "job completion must have a durable terminal commit");
  assert.match(src, /sawTurnCompleted/, "exit zero alone must not override failed JSONL semantics");
  assert.match(src, /sha256/, "terminal success must bind the final artifact hash");
});

test("Codex job controller and slash commands ship the lightweight lifecycle UX", () => {
  const rel = "scripts/codex-job.mjs";
  assert.ok(fs.existsSync(path.join(PLUGIN_ROOT, rel)), "job controller must ship with the plugin");
  const src = read(rel);
  assert.match(src, /startJob/);
  assert.match(src, /statusCommand/);
  assert.match(src, /resultCommand/);
  assert.match(src, /cancelCommand/);
  assert.match(src, /cancel\.request\.json/);
  assert.match(src, /terminal\.json/);
  assert.match(src, /owner\.json/);
  assert.match(src, /owner_token/, "runner identity must not depend on a truncated telemetry tail");
  assert.match(src, /job artifact escapes its directory/, "manifest paths must be contained in the job directory");
  assert.ok(
    src.indexOf("writeJsonExclusive(paths.manifest, manifest)") < src.indexOf("const runner = spawn"),
    "the observable manifest must be durable before a detached runner starts",
  );
  assert.doesNotMatch(src, /process\.kill\(manifest/, "controller must never signal a stored manifest PID");
  for (const command of ["codex-status", "codex-result", "codex-cancel"]) {
    const file = path.join(PLUGIN_ROOT, "commands", `${command}.md`);
    assert.ok(fs.existsSync(file), `${command} slash command must ship`);
    assert.match(fs.readFileSync(file, "utf8"), /codex-job\.mjs/);
  }
});

test("hooks.json wires the three hooks to existing scripts", () => {
  const hooks = JSON.parse(read("hooks/hooks.json"));
  const flat = JSON.stringify(hooks);
  assert.match(flat, /director-context\.js/);
  assert.match(flat, /tier-agent\.js/);
  assert.match(flat, /tier-workflow\.js/);
  for (const s of ["director-context.js", "tier-agent.js", "tier-workflow.js"])
    assert.ok(fs.existsSync(path.join(PLUGIN_ROOT, "hooks", "scripts", s)), `${s} must exist`);
});

test("hooks.json wires the director-enforce hook with an anchored matcher and plugin data dir", () => {
  const hooks = JSON.parse(read("hooks/hooks.json"));
  const pre = hooks.hooks.PreToolUse;
  const entry = pre.find((e) => /director-enforce\.js/.test(JSON.stringify(e.hooks)));
  assert.ok(entry, "a PreToolUse entry must invoke director-enforce.js");
  assert.equal(entry.matcher, "^(Edit|Write|NotebookEdit)$", "matcher must be anchored to the three edit tools");
  const cmd = entry.hooks[0].command;
  assert.match(cmd, /\$\{CLAUDE_PLUGIN_ROOT\}/, "command must resolve the script via CLAUDE_PLUGIN_ROOT");
  assert.match(cmd, /\$\{CLAUDE_PLUGIN_DATA\}/, "command must pass the state dir via CLAUDE_PLUGIN_DATA");
  assert.ok(
    fs.existsSync(path.join(PLUGIN_ROOT, "hooks", "scripts", "director-enforce.js")),
    "director-enforce.js must exist",
  );
});

test("director-enforce.js source keeps the fail-open contract and the ladder constants", () => {
  const src = read("hooks/scripts/director-enforce.js");
  assert.match(src, /MAX_TRIVIAL_LINES\s*=\s*10/);
  assert.match(src, /NUDGE_STRIKES\s*=\s*2/);
  assert.match(src, /agent_id/, "must key subagent detection off agent_id");
  assert.match(src, /\.handson/, "must implement the per-session hands-on flag");
  assert.match(src, /lask:implementer/, "nudge/deny text must point at lask:implementer");
});

test("director skill documents the enforcement hook and its escape hatch", () => {
  const body = read("skills/director/SKILL.md");
  assert.match(body, /## Hooks shipped with this plugin/);
  assert.match(body, /Edit\/Write\/NotebookEdit|direct file edit/i, "hooks section must name the enforcement hook");
  assert.match(body, /hands-on/i, "hooks section must document the hands-on escape hatch");
});

test("README documents the roster, the skills, and all three test commands", () => {
  const readme = fs.readFileSync(path.join(PLUGIN_ROOT, "..", "..", "README.md"), "utf8");
  for (const a of AGENTS) assert.match(readme, new RegExp(`lask:${a}`), `README must document lask:${a}`);
  assert.match(readme, /lask:director/);
  assert.match(readme, /lask:delegation-playbooks/);
  assert.match(readme, /node plugins\/lask\/hooks\/scripts\/tier\.test\.js/);
  assert.match(readme, /node plugins\/lask\/hooks\/scripts\/enforce\.test\.js/, "README must list the enforce.test.js command");
  assert.match(readme, /node --test plugins\/lask\/tests\//);
  assert.match(readme, /codex-jsonl-runner\.test\.mjs/, "README standard suite must run the behavioral runner tests");
  assert.match(readme, /codex-job\.test\.mjs/, "README standard suite must run job lifecycle tests");
  for (const command of ["codex-status", "codex-result", "codex-cancel"])
    assert.match(readme, new RegExp(`lask:${command}`), `README must document lask:${command}`);
  assert.match(readme, /LASK_E2E=1/);
  assert.match(readme, /director-enforce/, "README must document the enforcement hook");
  assert.match(readme, /hands-on/i, "README must document the hands-on escape hatch");
  assert.ok(!/lask:model-tiers/.test(readme), "README must not reference the retired skill");
});

test("marketplace.json lask entry version matches plugin.json", () => {
  const marketplace = JSON.parse(
    fs.readFileSync(path.join(PLUGIN_ROOT, "..", "..", ".claude-plugin", "marketplace.json"), "utf8"),
  );
  const pkg = JSON.parse(read(".claude-plugin/plugin.json"));
  const entry = JSON.stringify(marketplace);
  assert.match(entry, new RegExp(pkg.version.replace(/\./g, "\\.")), "marketplace must reference the current plugin version");
  assert.ok(!entry.includes("1.1.0"), "stale 1.1.0 version must not remain in marketplace.json");
});

test("director mode ships the four switch commands, each runnable", () => {
  for (const c of ["director-on", "director-off", "director-status", "director-reset"]) {
    const { fm, body } = parseFrontmatter(read(path.join("commands", `${c}.md`)));
    assert.ok(fm.description, `${c} needs a description for the command picker`);
    assert.match(body, /director-toggle\.js/, `${c} must invoke the toggle script`);
    assert.match(body, /\$\{CLAUDE_PLUGIN_ROOT\}/, `${c} must resolve the script via CLAUDE_PLUGIN_ROOT`);
  }
  for (const f of ["director-state.js", "director-toggle.js"])
    assert.ok(fs.existsSync(path.join(PLUGIN_ROOT, "hooks", "scripts", f)), `${f} must exist`);
});

test("director mode is documented as opt-in and off by default", () => {
  const skill = read("skills/director/SKILL.md");
  assert.match(skill, /opt-in/i, "the director skill must say the mode is opt-in");
  assert.match(skill, /LASK_DIRECTOR/, "the director skill must name the env switch");
  assert.match(skill, /lask:director-on/, "the director skill must name the slash switch");
});
