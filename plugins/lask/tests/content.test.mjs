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
  assert.match(src, /codex exec --sandbox read-only --skip-git-repo-check --color never/);
  assert.match(src, /--output-last-message/);
  assert.match(src, /- < "/, "prompt must travel via stdin redirection, not a shell argument");
  assert.match(src, /never as a shell argument/i);
  assert.match(src, /never substitute/i);
  assert.match(src, /no adoption decisions/i);
});

test("codex-implementer pins the sol/xhigh recipe and the rate-limit guard", () => {
  const src = read("agents/codex-implementer.md");
  assert.match(src, /codex exec -m gpt-5\.6-sol/, "must pin the model");
  assert.match(src, /model_reasoning_effort="xhigh"/, "must default to xhigh effort");
  assert.match(src, /--sandbox workspace-write/, "write mode is the whole point");
  assert.match(src, /--output-last-message/);
  assert.match(src, /- < "/, "prompt must travel via stdin redirection, not a shell argument");
  assert.match(src, /never as a shell argument/i);
  assert.match(src, /run_in_background/i, "must run long xhigh sessions in the background");
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
  assert.match(body, /- < "/, "prompt must travel via stdin redirection");
  assert.match(body, /run_in_background/i, "must run high/xhigh sessions in the background");
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
  assert.match(body, /claude -p/, "Codex->Claude tail guard must be present");
  assert.match(body, /10 minutes/, "must carry the measured timeout guidance");
  assert.match(body, /Skip this skill entirely/, "quick reference must keep the mechanical-task skip row");
  assert.ok(fs.existsSync(path.join(PLUGIN_ROOT, "skills", "fable-sense", "codex-agents-block.md")), "codex adapter must ship");
  assert.ok(fs.existsSync(path.join(PLUGIN_ROOT, "skills", "fable-sense", "eval", "RUBRICS.md")), "pre-registered rubrics must ship for re-validation");
  assert.ok(fs.existsSync(path.join(PLUGIN_ROOT, "skills", "fable-sense", "eval", "results", "grades.md")), "graded evidence must ship");
  const block = read("skills/fable-sense/codex-agents-block.md");
  for (const src of [body, block]) assert.match(src, /--output-format stream-json --verbose/, "Codex->Claude tail guard must stream — a silent claude -p reads as hung");
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

test("plugin.json is 1.6.3 and describes director mode and fable-sense", () => {
  const pkg = JSON.parse(read(".claude-plugin/plugin.json"));
  assert.equal(pkg.name, "lask");
  assert.equal(pkg.version, "1.6.3");
  assert.match(pkg.description, /director/i);
  assert.match(pkg.description, /fable-sense/);
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
