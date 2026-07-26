#!/usr/bin/env node
// Tests for the director on/off gate (director-state.js) and its effect on both
// gated hooks. Run: node plugins/lask/hooks/scripts/state.test.js
// Every case points LASK_STATE_DIR at an isolated temp dir, so a developer's own
// ~/.claude/lask switch never changes the result.
'use strict';

const { execFileSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const DIR = __dirname;
const CONTEXT = path.join(DIR, 'director-context.js');
const ENFORCE = path.join(DIR, 'director-enforce.js');
const TOGGLE = path.join(DIR, 'director-toggle.js');

let passed = 0;
let failed = 0;

function freshState() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'lask-state-test-'));
}

function run(script, { input = '{}', env = {}, args = [] } = {}) {
  try {
    const stdout = execFileSync(process.execPath, [script, ...args], {
      input,
      encoding: 'utf8',
      env: { ...process.env, ...env },
    });
    return { stdout, status: 0 };
  } catch (e) {
    return { stdout: e.stdout || '', stderr: e.stderr || '', status: e.status ?? 1 };
  }
}

function bigWrite(stateDir, env) {
  // 40-line Write to 1 file, three times: with the gate ON this reaches a deny.
  const enforceBase = fs.mkdtempSync(path.join(os.tmpdir(), 'lask-enforce-base-'));
  const session = 'gate-test-session';
  let last = { stdout: '' };
  for (let i = 0; i < 3; i++) {
    last = run(ENFORCE, {
      input: JSON.stringify({
        session_id: session,
        tool_name: 'Write',
        tool_input: { file_path: `/tmp/f${i}.txt`, content: Array.from({ length: 40 }, (_, n) => `l${n}`).join('\n') },
      }),
      args: [enforceBase],
      env: { LASK_STATE_DIR: stateDir, ...env },
    });
  }
  return last;
}

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ok  ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL  ${name}\n      ${e && e.message}`);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

// ---- gate resolution -------------------------------------------------------

test('1. default (no flags, no env) -> director OFF, no policy injected', () => {
  const s = freshState();
  const r = run(CONTEXT, { env: { LASK_STATE_DIR: s, LASK_DIRECTOR: '' } });
  assert(r.status === 0, `exit ${r.status}`);
  assert(r.stdout.trim() === '', `expected no output, got ${r.stdout.slice(0, 80)}`);
});

test('2. LASK_DIRECTOR=1 -> policy injected', () => {
  const s = freshState();
  const r = run(CONTEXT, { env: { LASK_STATE_DIR: s, LASK_DIRECTOR: '1' } });
  assert(r.stdout.includes('lask-director-policy'), 'policy block missing');
});

test('3. LASK_DIRECTOR=on/true/yes all count as on', () => {
  const s = freshState();
  for (const v of ['on', 'TRUE', 'Yes', 'enabled']) {
    const r = run(CONTEXT, { env: { LASK_STATE_DIR: s, LASK_DIRECTOR: v } });
    assert(r.stdout.includes('lask-director-policy'), `value ${v} did not enable`);
  }
});

test('4. unrecognised LASK_DIRECTOR value falls through to the default (off)', () => {
  const s = freshState();
  const r = run(CONTEXT, { env: { LASK_STATE_DIR: s, LASK_DIRECTOR: 'maybe' } });
  assert(r.stdout.trim() === '', 'garbage value should not enable director');
});

test('5. director.on flag beats an absent env', () => {
  const s = freshState();
  run(TOGGLE, { args: ['on'], env: { LASK_STATE_DIR: s, LASK_DIRECTOR: '' } });
  const r = run(CONTEXT, { env: { LASK_STATE_DIR: s, LASK_DIRECTOR: '' } });
  assert(r.stdout.includes('lask-director-policy'), 'on-flag did not enable director');
});

test('6. director.off flag beats LASK_DIRECTOR=1', () => {
  const s = freshState();
  run(TOGGLE, { args: ['off'], env: { LASK_STATE_DIR: s } });
  const r = run(CONTEXT, { env: { LASK_STATE_DIR: s, LASK_DIRECTOR: '1' } });
  assert(r.stdout.trim() === '', 'off-flag must win over the env var');
});

test('7. toggle on then off leaves only the off flag', () => {
  const s = freshState();
  run(TOGGLE, { args: ['on'], env: { LASK_STATE_DIR: s } });
  run(TOGGLE, { args: ['off'], env: { LASK_STATE_DIR: s } });
  assert(fs.existsSync(path.join(s, 'director.off')), 'off flag missing');
  assert(!fs.existsSync(path.join(s, 'director.on')), 'on flag should have been removed');
});

test('8. reset clears both flags and restores env control', () => {
  const s = freshState();
  run(TOGGLE, { args: ['off'], env: { LASK_STATE_DIR: s } });
  run(TOGGLE, { args: ['reset'], env: { LASK_STATE_DIR: s } });
  assert(!fs.existsSync(path.join(s, 'director.off')), 'off flag survived reset');
  const r = run(CONTEXT, { env: { LASK_STATE_DIR: s, LASK_DIRECTOR: '1' } });
  assert(r.stdout.includes('lask-director-policy'), 'env control not restored after reset');
});

test('9. unknown toggle action exits 2 without writing flags', () => {
  const s = freshState();
  const r = run(TOGGLE, { args: ['sideways'], env: { LASK_STATE_DIR: s } });
  assert(r.status === 2, `expected exit 2, got ${r.status}`);
  assert(!fs.existsSync(path.join(s, 'director.on')), 'no flag should be written');
});

// ---- enforcement follows the same gate -------------------------------------

test('10. director OFF -> repeated large writes are never throttled', () => {
  const s = freshState();
  const r = bigWrite(s, { LASK_DIRECTOR: '' });
  assert(r.stdout.trim() === '', `expected silence, got ${r.stdout.slice(0, 120)}`);
});

test('11. director ON -> the third large write is denied', () => {
  const s = freshState();
  const r = bigWrite(s, { LASK_DIRECTOR: '1' });
  assert(r.stdout.includes('"deny"'), `expected a deny, got ${r.stdout.slice(0, 120)}`);
});

test('12. status reports the deciding source', () => {
  const s = freshState();
  const r = run(TOGGLE, { args: ['status'], env: { LASK_STATE_DIR: s, LASK_DIRECTOR: '1' } });
  assert(/director mode: ON/.test(r.stdout), `unexpected status: ${r.stdout.slice(0, 120)}`);
  assert(/LASK_DIRECTOR=1/.test(r.stdout), 'status should name the deciding switch');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
