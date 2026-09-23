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
  "verifier",
  "reviewer",
  "second-opinion",
  "codex-implementer",
];

test("agents directory contains exactly the seven roster agents", () => {
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
});

test("read-only agents forbid mutation and the builder/grader split holds", () => {
  for (const name of ["scout", "researcher", "reviewer", "verifier"]) {
    assert.match(read(`agents/${name}.md`), /[Nn]ever (create, modify, or delete|modify)/, `${name}: must state read-only discipline`);
  }
  assert.match(read("agents/verifier.md"), /never fix/i);
  assert.match(read("agents/implementer.md"), /self-test/i);
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
  assert.match(src, /codex exec -m gpt-6-sol/, "must pin the model");
  assert.doesNotMatch(src, /gpt-5\.6/, "the previous generation must not linger in the implementer");
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
  for (const m of ["gpt-6-sol", "gpt-6-astra", "gpt-6-luna", "gpt-5.6-sol"]) {
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
  assert.match(body, /usage limit/i, "quota exhaustion must stop the run, not trigger retries");
  assert.match(fm["argument-hint"], /astra/, "argument-hint must offer the gpt-6 aliases");
  assert.match(body, /127\.0\.0\.1:8080/, "known MCP noise must be documented as ignorable");
  assert.match(body, /verbatim/i, "relay must be faithful");
});

test("model-tiers is retired and handoff survives", () => {
  assert.ok(!fs.existsSync(path.join(PLUGIN_ROOT, "skills", "model-tiers")), "model-tiers must be deleted");
  assert.ok(fs.existsSync(path.join(PLUGIN_ROOT, "skills", "handoff", "SKILL.md")));
});

test("plugin.json is 2.1.0 and describes the roster, the review loop and the playbook layer", () => {
  const pkg = JSON.parse(read(".claude-plugin/plugin.json"));
  assert.equal(pkg.name, "lask");
  assert.equal(pkg.version, "2.1.0");
  assert.match(pkg.description, /review-loop/);
  assert.match(pkg.description, /long-run/);
  assert.match(pkg.description, /doctor/);
  assert.match(pkg.description, /destructive-command guard/);
  assert.doesNotMatch(pkg.description, /director|fable-sense/i, "retired components must not be advertised");
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

test("hooks.json wires tiering, the destructive guard and the compact-only resume pointer; director machinery is gone", () => {
  const hooks = JSON.parse(read("hooks/hooks.json"));
  assert.deepEqual(Object.keys(hooks.hooks).sort(), ["PreToolUse", "SessionStart"]);
  const flat = JSON.stringify(hooks);
  for (const s of ["tier-agent.js", "tier-workflow.js", "destructive-guard.js", "run-resume.js"]) {
    assert.ok(flat.includes(s), `hooks.json must wire ${s}`);
    assert.ok(fs.existsSync(path.join(PLUGIN_ROOT, "hooks", "scripts", s)), `${s} must exist`);
  }
  const guard = hooks.hooks.PreToolUse.find((h) => JSON.stringify(h).includes("destructive-guard.js"));
  assert.equal(guard.matcher, "^(Bash|PowerShell)$", "the guard must cover both shells");
  // No policy injection at startup: SessionStart only fires after a compaction, and only points at TASKS.md.
  for (const entry of hooks.hooks.SessionStart) assert.equal(entry.matcher, "compact", "SessionStart may only fire on compact");
  assert.doesNotMatch(read("hooks/scripts/destructive-guard.js"), /permissionDecision: 'deny'/, "the guard asks; the user decides");
  assert.doesNotMatch(flat, /director/);
  for (const gone of ["skills/director", "skills/delegation-playbooks", "skills/fable-sense", "agents/debugger.md",
    "commands/director-on.md", "hooks/scripts/director-enforce.js", "hooks/scripts/director-context.js"])
    assert.ok(!fs.existsSync(path.join(PLUGIN_ROOT, gone)), `${gone} must be retired to archive/`);
});

test("playbook skills carry their contracts", () => {
  for (const name of ["long-run", "fan-out", "design-brief"]) {
    const { fm } = parseFrontmatter(read(`skills/${name}/SKILL.md`));
    assert.equal(fm.name, name);
    assert.match(fm.description, /^Use when /, `${name}: description must state triggering conditions`);
    assert.match(fm.description, /Not for /, `${name}: description must carry a skip-gate`);
    assert.ok(fm.description.length <= 400, `${name}: keep the listing short`);
  }
  const longRun = read("skills/long-run/SKILL.md");
  for (const s of ["Done means:", "Stop and ask only if:", "TASKS.md", "Blocked on owner", "## Blocked on me", "## Changed", "## Found", "compaction"])
    assert.ok(longRun.includes(s), `long-run must carry ${s}`);
  assert.ok(longRun.indexOf("## Blocked on me") < longRun.indexOf("## Changed"), "what the owner owes comes first");
  const fanOut = read("skills/fan-out/SKILL.md");
  for (const s of ["ONE message", "could not confirm", "evidence", "lask:review-loop", "isolation", "Workflow"])
    assert.ok(fanOut.includes(s), `fan-out must carry ${s}`);
  assert.match(fanOut, /re-dispatch that unit once/i, "evidence-free verdicts are re-dispatched, not averaged in");
  const design = read("skills/design-brief/SKILL.md");
  for (const s of ["~/.claude/lask/design-avoid.md", ".claude/design-avoid.md", "templates/design-avoid.md", "Never delete lines"])
    assert.ok(design.includes(s), `design-brief must carry ${s}`);
});

test("templates ship the stop rule, the report shape and the design seed", () => {
  const t = read("templates/claude-md-autonomy.md");
  assert.match(t, /Stop and ask only when/);
  assert.match(t, /git push --force/);
  assert.match(t, /outside\s+the\s+current repository/);
  assert.match(t, /Done means:/);
  assert.match(t, /`Blocked on me`[\s\S]*`Changed`[\s\S]*`Found`/, "report headings in owner-first order");
  assert.match(t, /could not confirm/);
  assert.doesNotMatch(t, /lask:autonomy:(?:begin|end)/, "markers are added by the doctor, not stored in the template");
  assert.match(t, /Subagents follow the report protocol/, "subagents load CLAUDE.md too; they keep their own report shape");
  assert.match(t, /lask:handoff/, "skills that fix their own output format win");
  assert.match(t, /design avoid list/, "lists a skill maintains at the user's request are not a stop");
  const seed = read("templates/design-avoid.md");
  assert.ok((seed.match(/^- /gm) || []).length >= 5, "the seed must name concrete patterns");
});

test("doctor command and script ship; researcher marks what it could not confirm", () => {
  const { fm, body } = parseFrontmatter(read("commands/doctor.md"));
  assert.equal(fm["disable-model-invocation"], "true");
  assert.match(body, /scripts\/doctor\.mjs/);
  const src = read("scripts/doctor.mjs");
  for (const id of ["stop-rule", "think-lines", "reasoning-requests", "destructive-guard", "design-avoid", "tasks-file", "flag-switch"])
    assert.ok(src.includes(`"${id}"`), `doctor must check ${id}`);
  assert.match(src, /bak-lask-/, "--install must back up CLAUDE.md");
  assert.match(read("agents/researcher.md"), /could not confirm, and say where you looked/);
});

test("the plugin's own instructions carry no think-harder or show-your-reasoning lines", () => {
  const files = [
    ...fs.readdirSync(path.join(PLUGIN_ROOT, "agents")).map((f) => `agents/${f}`),
    ...fs.readdirSync(path.join(PLUGIN_ROOT, "skills")).map((d) => `skills/${d}/SKILL.md`),
    ...fs.readdirSync(path.join(PLUGIN_ROOT, "commands")).map((f) => `commands/${f}`),
    ...fs.readdirSync(path.join(PLUGIN_ROOT, "templates")).map((f) => `templates/${f}`),
  ].filter((f) => fs.existsSync(path.join(PLUGIN_ROOT, f)));
  for (const f of files) {
    const src = read(f);
    assert.doesNotMatch(src, /\bthink\s+(?:very\s+|really\s+)?(?:carefully|hard(?:er)?|deeply|step[- ]by[- ]step)\b|\bultrathink\b/i, `${f}: Opus 5.5 thinks by itself; use effort`);
    assert.doesNotMatch(src, /\bshow\s+(?:me\s+)?your\s+(?:reasoning|thinking|chain[- ]of[- ]thought)\b/i, `${f}: never ask to reproduce reasoning`);
  }
});

test("review-loop skill carries the isolated two-family review, adjudication, judge validation and tiers", () => {
  const { fm, body } = parseFrontmatter(read("skills/review-loop/SKILL.md"));
  assert.equal(fm.name, "review-loop");
  assert.match(fm.description, /^Use when /, "description must state triggering conditions");
  assert.match(fm.description, /Not for /, "description must carry a skip-gate");
  assert.match(body, /lask:reviewer/);
  assert.match(body, /lask:second-opinion/);
  assert.match(body, /ONE message/, "the two reviewers must be dispatched in parallel");
  assert.match(body, /not confirmed/i, "single-reviewer findings default to not confirmed");
  assert.match(body, /deliberately broken/i, "the judge must be validated against a broken variant");
  assert.match(body, /third time/i, "recurring failures move upstream");
  for (const t of ["sonnet", "opus", "fable", "tier: reviewed"]) assert.match(body, new RegExp(t), `tier table must mention ${t}`);
  assert.match(read("hooks/scripts/tier-workflow.js"), /lask:review-loop/, "the workflow deny reason must point here");
  assert.match(body, /different model families/i, "reviewers must come from different families");
  assert.match(body, /identical/i, "every reviewer gets the same brief");
  assert.match(body, /mutation/i, "the brief must ask which mutation breaks each cited test");
  assert.match(body, /open question/i, "schema gaps are open questions, not findings");
  assert.match(body, /0 rejected/, "the validation evidence must ship with the skill");
  const fam = read("skills/review-loop/second-family.md");
  for (const s of ["lask:second-opinion", "muse exec", "opencode2 session export", "usage limit"])
    assert.ok(fam.includes(s), `second-family.md must document ${s}`);
});

test("reviewer is adversarial and spec-anchored; verifier checks its own judge", () => {
  assert.match(read("agents/reviewer.md"), /assume the change is wrong/i);
  assert.match(read("agents/reviewer.md"), /spec line/i);
  assert.match(read("agents/reviewer.md"), /mutation/i, "reviewer must test the tests it is shown");
  assert.match(read("agents/verifier.md"), /deliberately broken/i);
});

test("README documents the roster, the skills, and the test commands", () => {
  const readme = fs.readFileSync(path.join(PLUGIN_ROOT, "..", "..", "README.md"), "utf8");
  for (const a of AGENTS) assert.match(readme, new RegExp(`lask:${a}`), `README must document lask:${a}`);
  for (const s of ["review-loop", "long-run", "fan-out", "design-brief", "doctor", "handoff", "codex-run", "codex-status", "codex-result", "codex-cancel"])
    assert.match(readme, new RegExp(`lask:${s}`), `README must document lask:${s}`);
  assert.match(readme, /node plugins\/lask\/hooks\/scripts\/tier\.test\.js/);
  assert.match(readme, /node --test plugins\/lask\/tests\//);
  assert.match(readme, /codex-jsonl-runner\.test\.mjs/, "README standard suite must run the behavioral runner tests");
  assert.match(readme, /codex-job\.test\.mjs/, "README standard suite must run job lifecycle tests");
  assert.match(readme, /hooks\.test\.mjs/, "README standard suite must run the guard/resume hook tests");
  assert.match(readme, /doctor\.test\.mjs/, "README standard suite must run the doctor tests");
  assert.match(readme, /LASK_GUARD=0/, "README must document the guard off switch");
  assert.match(readme, /LASK_E2E=1/);
  assert.match(readme, /archive\/lask-1\.8/, "README must say where the retired components went");
  assert.doesNotMatch(readme, /lask:director|lask:delegation-playbooks|lask:fable-sense|lask:debugger|enforce\.test\.js/,
    "README must not advertise retired components");
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
