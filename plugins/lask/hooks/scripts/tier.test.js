#!/usr/bin/env node
// Tests for the lask model-tiering hook scripts.
// Run: node plugins/lask/hooks/scripts/tier.test.js
'use strict';

const { execFileSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const DIR = __dirname;
const GATE_STATE = fs.mkdtempSync(path.join(os.tmpdir(), 'lask-tier-gate-'));

let passed = 0;
let failed = 0;

function runHook(script, input) {
  const raw = typeof input === 'string' ? input : JSON.stringify(input);
  try {
    const stdout = execFileSync(process.execPath, [path.join(DIR, script)], {
      input: raw,
      encoding: 'utf8',
      env: { ...process.env, LASK_STATE_DIR: GATE_STATE },
    });
    return { stdout, status: 0 };
  } catch (e) {
    return { stdout: e.stdout || '', status: e.status ?? 1 };
  }
}

function parseOut(res) {
  return res.stdout.trim() ? JSON.parse(res.stdout) : null;
}

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`ok - ${name}`);
  } catch (e) {
    failed++;
    console.error(`FAIL - ${name}\n  ${e.message}`);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

const agentInput = (tool_input, tool_name = 'Agent') => ({
  hook_event_name: 'PreToolUse',
  tool_name,
  tool_input,
});

const wfInput = (tool_input) => ({
  hook_event_name: 'PreToolUse',
  tool_name: 'Workflow',
  tool_input,
});

// ---------- tier-agent.js ----------

test('agent: explicit non-fable model passes through untouched', () => {
  for (const model of ['sonnet', 'opus', 'haiku']) {
    const res = runHook('tier-agent.js', agentInput({ prompt: 'x', model }));
    assert(res.status === 0, `exit ${res.status}`);
    assert(res.stdout.trim() === '', `${model}: expected no output, got: ${res.stdout}`);
  }
});

test('agent: explicit fable is rewritten to opus (fable subagents retired)', () => {
  for (const [model, subagent_type] of [['fable', undefined], ['claude-fable-5-1', 'lask:reviewer']]) {
    const out = parseOut(runHook('tier-agent.js', agentInput({ prompt: 'x', model, subagent_type })));
    const h = out && out.hookSpecificOutput;
    assert(h && h.permissionDecision === 'allow', `${model}: expected allow`);
    assert(h.updatedInput.model === 'opus', `${model}: model=${h.updatedInput.model}`);
    assert(h.updatedInput.prompt === 'x', 'other fields must be preserved');
    assert(/retired/.test(h.permissionDecisionReason), 'reason must say fable is retired');
  }
});

test('agent: model "inherit" counts as unset (it would hand down a fable main loop)', () => {
  const plain = parseOut(runHook('tier-agent.js', agentInput({ prompt: 'x', model: 'inherit' })));
  assert(plain.hookSpecificOutput.updatedInput.model === 'opus', 'inherit on a built-in agent -> opus');
  const explore = parseOut(runHook('tier-agent.js', agentInput({ prompt: 'x', model: 'inherit', subagent_type: 'Explore' })));
  assert(explore.hookSpecificOutput.updatedInput.model === 'sonnet', 'inherit on Explore -> sonnet');
  const plugin = parseOut(runHook('tier-agent.js', agentInput({ prompt: 'x', model: 'inherit', subagent_type: 'lask:scout' })));
  const h = plugin && plugin.hookSpecificOutput;
  assert(h && h.permissionDecision === 'allow', 'expected allow');
  assert(!('model' in h.updatedInput) && h.updatedInput.subagent_type === 'lask:scout', 'plugin agent: model dropped, definition governs');
});

test('agent: omitted model defaults to opus', () => {
  const res = runHook('tier-agent.js', agentInput({ prompt: 'x', subagent_type: 'general-purpose' }));
  const out = parseOut(res);
  const h = out && out.hookSpecificOutput;
  assert(h && h.permissionDecision === 'allow', 'expected allow');
  assert(h.updatedInput.model === 'opus', `model=${h && h.updatedInput && h.updatedInput.model}`);
  assert(h.updatedInput.prompt === 'x', 'other fields must be preserved');
});

test('agent: no subagent_type defaults to opus', () => {
  const out = parseOut(runHook('tier-agent.js', agentInput({ prompt: 'x' })));
  assert(out.hookSpecificOutput.updatedInput.model === 'opus', 'expected opus');
});

test('agent: Explore defaults to sonnet', () => {
  const out = parseOut(runHook('tier-agent.js', agentInput({ prompt: 'x', subagent_type: 'Explore' })));
  assert(out.hookSpecificOutput.updatedInput.model === 'sonnet', 'expected sonnet');
});

test('agent: plugin-namespaced subagent_type left to its definition', () => {
  const res = runHook('tier-agent.js', agentInput({ prompt: 'x', subagent_type: 'codex:codex-rescue' }));
  assert(res.status === 0 && res.stdout.trim() === '', 'expected pass-through');
});

test('agent: Task tool name handled the same', () => {
  const out = parseOut(runHook('tier-agent.js', agentInput({ prompt: 'x' }, 'Task')));
  assert(out.hookSpecificOutput.updatedInput.model === 'opus', 'expected opus');
});

test('agent: malformed stdin fails open', () => {
  const res = runHook('tier-agent.js', 'this is not json');
  assert(res.status === 0 && res.stdout.trim() === '', 'expected silent pass-through');
});

// ---------- tier-workflow.js ----------

const META = "export const meta = { name: 'x', description: 'y' }\n";

test('workflow: all agent() calls tiered -> pass', () => {
  const script =
    META +
    "const a = await agent('do x', { model: 'sonnet', effort: 'medium' })\n" +
    'const b = await agent("y", { schema: S, model: \'opus\', effort: \'high\' })\n';
  const res = runHook('tier-workflow.js', wfInput({ script }));
  assert(res.status === 0 && res.stdout.trim() === '', `expected pass, got: ${res.stdout}`);
});

test('workflow: untier-ed agent() call -> deny with instructive reason', () => {
  const script = META + "const a = await agent('do x', { schema: S })\n";
  const out = parseOut(runHook('tier-workflow.js', wfInput({ script })));
  const h = out && out.hookSpecificOutput;
  assert(h && h.permissionDecision === 'deny', 'expected deny');
  assert(/sonnet/.test(h.permissionDecisionReason) && /opus/.test(h.permissionDecisionReason) && /fable/.test(h.permissionDecisionReason), 'reason must restate tiers');
  assert(/tier: reviewed/.test(h.permissionDecisionReason), 'reason must name the bypass marker');
  assert(/lask:review-loop/.test(h.permissionDecisionReason), 'reason must point at the review-loop skill');
  assert(/effort/.test(h.permissionDecisionReason) && /'medium'/.test(h.permissionDecisionReason), 'reason must restate the effort rubric');
});

test('workflow: model fable -> deny (fable retired), fable inside a prompt string does not', () => {
  for (const script of [
    META + "await agent('x', { model: 'fable' })\n",
    META + 'await agent("x", {\n  model: "claude-fable-5-1",\n})\n',
    META + "await agent('x', { model: hard ? 'fable' : 'opus', label: 'y' })\n",
  ]) {
    const out = parseOut(runHook('tier-workflow.js', wfInput({ script })));
    assert(out && out.hookSpecificOutput.permissionDecision === 'deny', `expected deny for: ${script}`);
  }
  const ok = META + "await agent(\"compare model: 'fable' output\", { model: 'opus', effort: 'high' })\n";
  const res = runHook('tier-workflow.js', wfInput({ script: ok }));
  assert(res.stdout.trim() === '', `prompt text must not trip the check, got: ${res.stdout}`);
});

test('workflow: agent() with no opts at all -> deny', () => {
  const script = META + "await agent('just do it')\n";
  const out = parseOut(runHook('tier-workflow.js', wfInput({ script })));
  assert(out.hookSpecificOutput.permissionDecision === 'deny', 'expected deny');
});

test('workflow: agentType satisfies the tier requirement (effort still required when not pinned)', () => {
  const ok = META + "await agent('x', { agentType: 'Explore', effort: 'medium' })\n";
  assert(runHook('tier-workflow.js', wfInput({ script: ok })).stdout.trim() === '', 'expected pass');
  const bad = META + "await agent('x', { agentType: 'Explore' })\n";
  const out = parseOut(runHook('tier-workflow.js', wfInput({ script: bad })));
  assert(out && out.hookSpecificOutput.permissionDecision === 'deny', 'unpinned agentType without effort must deny');
});

test('workflow: spread opts treated as compliant (not statically knowable)', () => {
  const script = META + "await agent('x', { ...opts })\n";
  const res = runHook('tier-workflow.js', wfInput({ script }));
  assert(res.stdout.trim() === '', 'expected pass');
});

test('workflow: tier reviewed marker bypasses the check', () => {
  const script = '/* tier: reviewed */\n' + META + "await agent('x')\n";
  const res = runHook('tier-workflow.js', wfInput({ script }));
  assert(res.stdout.trim() === '', 'expected pass');
});

test('workflow: agent( inside string/template literals is ignored', () => {
  const script =
    META +
    'await agent(`verify the agent(...) call in ${f.title}`, { model: \'opus\', effort: \'high\' })\n' +
    "await agent('the word agent(x) appears here', { model: 'sonnet', effort: 'medium' })\n";
  const res = runHook('tier-workflow.js', wfInput({ script }));
  assert(res.stdout.trim() === '', `expected pass, got: ${res.stdout}`);
});

test('workflow: agent( inside comments is ignored', () => {
  const script = META + '// agent(\n/* agent( */\nawait agent("x", { model: "opus", effort: "high" })\n';
  const res = runHook('tier-workflow.js', wfInput({ script }));
  assert(res.stdout.trim() === '', 'expected pass');
});

test('workflow: nested parens inside the call are balanced', () => {
  const ok = META + "await agent(mkPrompt(a, b(c)), { model: 'opus', effort: 'high' })\n";
  const bad = META + 'await agent(mkPrompt(a, b(c)))\n';
  assert(runHook('tier-workflow.js', wfInput({ script: ok })).stdout.trim() === '', 'nested ok should pass');
  const out = parseOut(runHook('tier-workflow.js', wfInput({ script: bad })));
  assert(out.hookSpecificOutput.permissionDecision === 'deny', 'nested bad should deny');
});

test('workflow: subagent-like identifiers do not match', () => {
  const script = META + 'await subagent("x")\nfoo.agent("y")\nconst reagent = reagent(1)\n';
  const res = runHook('tier-workflow.js', wfInput({ script }));
  assert(res.stdout.trim() === '', 'expected pass');
});

test('workflow: model passed deeper in multi-line opts', () => {
  const script =
    META +
    "await agent('long task', {\n  label: 'x',\n  phase: 'Find',\n  schema: FOO,\n  model: 'sonnet',\n  effort: 'medium',\n})\n";
  const res = runHook('tier-workflow.js', wfInput({ script }));
  assert(res.stdout.trim() === '', 'expected pass');
});

test('workflow: model without effort -> deny, and the reason names the gap', () => {
  const script = META + "await agent('write the parser', { model: 'opus' })\n";
  const out = parseOut(runHook('tier-workflow.js', wfInput({ script })));
  const h = out && out.hookSpecificOutput;
  assert(h && h.permissionDecision === 'deny', 'expected deny');
  assert(/no effort/.test(h.permissionDecisionReason), `reason must say which rule failed: ${h.permissionDecisionReason}`);
});

test('workflow: an effort literal must be a real level; an expression is trusted', () => {
  for (const level of ['low', 'medium', 'high', 'xhigh', 'max']) {
    const script = META + `await agent('x', { model: 'opus', effort: '${level}' })\n`;
    assert(runHook('tier-workflow.js', wfInput({ script })).stdout.trim() === '', `${level} should pass`);
  }
  const bad = META + "await agent('x', { model: 'opus', effort: 'extreme' })\n";
  const out = parseOut(runHook('tier-workflow.js', wfInput({ script: bad })));
  assert(out && out.hookSpecificOutput.permissionDecision === 'deny', 'unknown level must deny');
  assert(/not a level/.test(out.hookSpecificOutput.permissionDecisionReason), 'reason must say the level is invalid');
  const expr = META + "await agent('x', { model: 'opus', effort: hard ? 'xhigh' : 'high' })\n";
  assert(runHook('tier-workflow.js', wfInput({ script: expr })).stdout.trim() === '', 'expression should pass');
});

test('workflow: a lask agentType whose definition pins effort satisfies it; an unpinned one does not', () => {
  // Pins come from plugins/lask/agents/*.md: scout/verifier medium, reviewer/implementer high.
  for (const t of ['lask:reviewer', 'lask:implementer', 'lask:scout', 'lask:verifier']) {
    const script = META + `await agent('x', { agentType: '${t}' })\n`;
    assert(runHook('tier-workflow.js', wfInput({ script })).stdout.trim() === '', `${t} is pinned and should pass`);
  }
  for (const t of ['lask:researcher', 'general-purpose']) {
    const script = META + `await agent('x', { agentType: '${t}' })\n`;
    const out = parseOut(runHook('tier-workflow.js', wfInput({ script })));
    assert(out && out.hookSpecificOutput.permissionDecision === 'deny', `${t} is unpinned and must deny without effort`);
  }
  const research = META + "await agent('x', { agentType: 'lask:researcher', effort: 'xhigh' })\n";
  assert(runHook('tier-workflow.js', wfInput({ script: research })).stdout.trim() === '', 'explicit effort on an unpinned agent passes');
});

test('workflow: effort named inside a prompt string does not count', () => {
  const script = META + "await agent(\"use effort: 'high' here\", { model: 'opus' })\n";
  const out = parseOut(runHook('tier-workflow.js', wfInput({ script })));
  assert(out && out.hookSpecificOutput.permissionDecision === 'deny', 'prompt text must not satisfy the effort rule');
});

test('workflow: only top-level options of the last argument count (nested keys and spreads do not)', () => {
  const deny = [
    // a structured-output schema with an `effort` property is not the call's effort
    "await agent('x', { model: 'opus', schema: { properties: { effort: { type: 'string' } } } })\n",
    "await agent('x', { model: 'opus', config: { effort: 'medium' } })\n",
    // a nested agentType is not the call's agentType
    "await agent('x', { model: 'opus', foo: { agentType: 'lask:scout' } })\n",
    // a spread inside the prompt or a nested array is not an options spread
    "await agent(mk(...parts), { model: 'opus' })\n",
    "await agent('x', { model: 'opus', data: [...xs] })\n",
    // an effort named only in a comment
    "await agent('x', { model: 'opus' /* effort: 'high' */ })\n",
  ];
  for (const body of deny) {
    const out = parseOut(runHook('tier-workflow.js', wfInput({ script: META + body })));
    assert(out && out.hookSpecificOutput.permissionDecision === 'deny', `expected deny: ${body}`);
  }
  // a nested key must not make a compliant pinned call look invalid either
  const pinnedWithSchema = META + "await agent('x', { agentType: 'lask:scout', schema: { effort: 'hgih' } })\n";
  assert(runHook('tier-workflow.js', wfInput({ script: pinnedWithSchema })).stdout.trim() === '', 'nested key must not fail a pinned call');
});

test('workflow: shorthand, quoted keys, comments and literal forms', () => {
  const pass = [
    "const effort = 'high'\nawait agent('x', { model: 'opus', effort })\n",
    "await agent('x', { 'model': 'opus', \"effort\": 'high' })\n",
    "await agent('x', { agentType: 'lask:scout' // recon\n })\n",
    "await agent('x', { model: 'opus', effort: 'high' // bulk\n })\n",
    "await agent('x', { model: 'opus', effort: `high` })\n",
    "await agent('x', { model: 'opus', effort: `x${lvl}` })\n", // template with interpolation = expression
    "await agent('x', { model: 'opus', effort: 'hi' + 'gh' })\n", // concatenation = expression
  ];
  for (const body of pass) {
    const res = runHook('tier-workflow.js', wfInput({ script: META + body }));
    assert(res.stdout.trim() === '', `expected pass: ${body} -> ${res.stdout}`);
  }
  const deny = [
    "await agent('x', { model: 'opus', effort: 'hgih' // typo\n })\n",
    "await agent('x', { model: 'opus', effort: 'extreme' /* lvl */ })\n",
    "await agent('x', { model: 'opus', effort: `hgih` })\n",
    "await agent('x', { model: 'opus', effort: 'say \"hi\"' })\n",
  ];
  for (const body of deny) {
    const out = parseOut(runHook('tier-workflow.js', wfInput({ script: META + body })));
    assert(out && out.hookSpecificOutput.permissionDecision === 'deny', `expected deny: ${body}`);
  }
});

test('workflow: pins come from the agent frontmatter; no pins is stricter, never looser', () => {
  const { findViolations, pinnedEfforts } = require('./tier-workflow.js');
  // Independently parse plugins/lask/agents/*.md and compare with what the hook reads.
  const dir = path.join(DIR, '..', '..', 'agents');
  const expected = new Map();
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.md'))) {
    const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(fs.readFileSync(path.join(dir, f), 'utf8'))[1];
    const e = /^effort:\s*(\S+)/m.exec(fm);
    if (e) expected.set(/^name:\s*(\S+)/m.exec(fm)[1], e[1]);
  }
  const got = pinnedEfforts();
  assert(expected.size >= 4, `expected at least 4 pinned agents, frontmatter has ${expected.size}`);
  assert(JSON.stringify([...got].sort()) === JSON.stringify([...expected].sort()), `pins ${JSON.stringify([...got])} != frontmatter ${JSON.stringify([...expected])}`);
  const pinnedCall = META + "await agent('x', { agentType: 'lask:scout' })\n";
  assert(findViolations(pinnedCall, got).length === 0, 'pinned call passes with the real pins');
  assert(findViolations(pinnedCall, new Map()).length === 1, 'with no readable pins the same call must be denied');
  // the deny reason lists the pinned set as read, not a hardcoded copy
  const out = parseOut(runHook('tier-workflow.js', wfInput({ script: META + "await agent('x', { model: 'opus' })\n" })));
  for (const name of expected.keys()) {
    assert(out.hookSpecificOutput.permissionDecisionReason.includes(`lask:${name}`), `reason must list lask:${name}`);
  }
});

test('workflow: named workflow / resume without script -> pass', () => {
  const res = runHook('tier-workflow.js', wfInput({ name: 'review-changes' }));
  assert(res.status === 0 && res.stdout.trim() === '', 'expected pass');
});

test('workflow: scriptPath is read and validated', () => {
  const tmp = path.join(os.tmpdir(), `tier-test-${process.pid}.js`);
  fs.writeFileSync(tmp, META + "await agent('x')\n");
  try {
    const out = parseOut(runHook('tier-workflow.js', wfInput({ scriptPath: tmp })));
    assert(out.hookSpecificOutput.permissionDecision === 'deny', 'expected deny from scriptPath');
  } finally {
    fs.unlinkSync(tmp);
  }
});

test('workflow: unreadable scriptPath fails open', () => {
  const res = runHook('tier-workflow.js', wfInput({ scriptPath: path.join(os.tmpdir(), 'nope-does-not-exist.js') }));
  assert(res.status === 0 && res.stdout.trim() === '', 'expected pass-through');
});

test('workflow: malformed stdin fails open', () => {
  const res = runHook('tier-workflow.js', '{{{');
  assert(res.status === 0 && res.stdout.trim() === '', 'expected silent pass-through');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
