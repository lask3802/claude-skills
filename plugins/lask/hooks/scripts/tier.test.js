#!/usr/bin/env node
// Tests for the lask model-tiering hook scripts.
// Run: node plugins/lask/hooks/scripts/tier.test.js
'use strict';

const { execFileSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const DIR = __dirname;
let passed = 0;
let failed = 0;

function runHook(script, input) {
  const raw = typeof input === 'string' ? input : JSON.stringify(input);
  try {
    const stdout = execFileSync(process.execPath, [path.join(DIR, script)], {
      input: raw,
      encoding: 'utf8',
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

test('agent: explicit model passes through untouched (incl. fable)', () => {
  const res = runHook('tier-agent.js', agentInput({ prompt: 'x', model: 'fable' }));
  assert(res.status === 0, `exit ${res.status}`);
  assert(res.stdout.trim() === '', `expected no output, got: ${res.stdout}`);
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
    "const a = await agent('do x', { model: 'sonnet' })\n" +
    'const b = await agent("y", { schema: S, model: \'opus\' })\n';
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
  assert(/lask:director/.test(h.permissionDecisionReason), 'reason must point at the director skill');
});

test('workflow: agent() with no opts at all -> deny', () => {
  const script = META + "await agent('just do it')\n";
  const out = parseOut(runHook('tier-workflow.js', wfInput({ script })));
  assert(out.hookSpecificOutput.permissionDecision === 'deny', 'expected deny');
});

test('workflow: agentType satisfies the tier requirement', () => {
  const script = META + "await agent('x', { agentType: 'Explore' })\n";
  const res = runHook('tier-workflow.js', wfInput({ script }));
  assert(res.stdout.trim() === '', 'expected pass');
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
    'await agent(`verify the agent(...) call in ${f.title}`, { model: \'opus\' })\n' +
    "await agent('the word agent(x) appears here', { model: 'sonnet' })\n";
  const res = runHook('tier-workflow.js', wfInput({ script }));
  assert(res.stdout.trim() === '', `expected pass, got: ${res.stdout}`);
});

test('workflow: agent( inside comments is ignored', () => {
  const script = META + '// agent(\n/* agent( */\nawait agent("x", { model: "opus" })\n';
  const res = runHook('tier-workflow.js', wfInput({ script }));
  assert(res.stdout.trim() === '', 'expected pass');
});

test('workflow: nested parens inside the call are balanced', () => {
  const ok = META + "await agent(mkPrompt(a, b(c)), { model: 'opus' })\n";
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
    "await agent('long task', {\n  label: 'x',\n  phase: 'Find',\n  schema: FOO,\n  model: 'sonnet',\n})\n";
  const res = runHook('tier-workflow.js', wfInput({ script }));
  assert(res.stdout.trim() === '', 'expected pass');
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

// ---------- director-context.js ----------

test('context: emits the director policy with roster, skills, and tiers', () => {
  const res = runHook('director-context.js', { hook_event_name: 'SessionStart', source: 'startup' });
  const out = parseOut(res);
  const ctx = out && out.hookSpecificOutput && out.hookSpecificOutput.additionalContext;
  assert(typeof ctx === 'string' && ctx.length > 0, 'expected additionalContext');
  assert(out.hookSpecificOutput.hookEventName === 'SessionStart', 'expected SessionStart event name');
  assert(ctx.includes('<lask-director-policy>') && ctx.includes('</lask-director-policy>'), 'context must be wrapped in the policy tag');
  for (const m of ['sonnet', 'opus', 'fable']) assert(ctx.includes(m), `context must mention ${m}`);
  for (const a of ['lask:scout', 'lask:researcher', 'lask:implementer', 'lask:debugger', 'lask:verifier', 'lask:reviewer', 'lask:second-opinion', 'lask:codex-implementer'])
    assert(ctx.includes(a), `context must list ${a}`);
  assert(ctx.includes('lask:director'), 'context must point at the director skill');
  assert(ctx.includes('lask:delegation-playbooks'), 'context must point at the playbooks skill');
  assert(ctx.includes('<=10 lines') || ctx.includes('≤10 lines'), 'context must state the direct-work threshold');
  assert(/acceptance criteria/i.test(ctx), 'context must name the dispatch four-piece set');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
