#!/usr/bin/env node
// Tests for the lask director-mode enforcement hook (director-enforce.js).
// Run: node plugins/lask/hooks/scripts/enforce.test.js
// Uses an isolated temp state dir passed via argv[2] and unique session ids per case.
'use strict';

const { execFileSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const DIR = __dirname;
const SCRIPT = path.join(DIR, 'director-enforce.js');
const STATE = fs.mkdtempSync(path.join(os.tmpdir(), 'lask-enforce-test-'));

let passed = 0;
let failed = 0;
let counter = 0;

function uid() {
  return `enforce-${process.pid}-${counter++}`;
}

function lines(n) {
  return Array.from({ length: n }, (_, i) => `line ${i}`).join('\n');
}

function run(input, stateDir) {
  const raw = typeof input === 'string' ? input : JSON.stringify(input);
  const args = [SCRIPT];
  if (stateDir !== undefined) args.push(stateDir);
  try {
    const stdout = execFileSync(process.execPath, args, { input: raw, encoding: 'utf8' });
    return { stdout, status: 0 };
  } catch (e) {
    return { stdout: e.stdout || '', status: e.status ?? 1 };
  }
}

function parseOut(res) {
  return res.stdout.trim() ? JSON.parse(res.stdout) : null;
}

function edit(tool_name, tool_input, extra = {}) {
  return { hook_event_name: 'PreToolUse', tool_name, tool_input, ...extra };
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

// 1. agent_id present -> silent allow even for a large edit (subagent labor is the path)
test('1. agent_id present -> silent allow', () => {
  const res = run(
    edit('Write', { file_path: 'x.js', content: lines(50) }, { session_id: uid(), agent_id: 'agent-abc' }),
    STATE,
  );
  assert(res.status === 0, `exit ${res.status}`);
  assert(res.stdout.trim() === '', `expected no output, got: ${res.stdout}`);
});

// 2. main-session small (<=10 lines) single-file Edit -> silent allow
test('2. small single-file Edit -> silent allow', () => {
  const res = run(edit('Edit', { file_path: 'a.js', new_string: 'one\ntwo\nthree' }, { session_id: uid() }), STATE);
  assert(res.status === 0 && res.stdout.trim() === '', `expected silent allow, got: ${res.stdout}`);
});

// The strike ladder shares one session id: 11+ line edits stack strikes 1, 2, then deny.
const LADDER = uid();
const BIG = lines(15); // 15 lines > MAX_TRIVIAL_LINES

// 3. main-session 11+ line Edit -> allow + additionalContext (strike 1)
test('3. large Edit -> allow + nudge (strike 1)', () => {
  const out = parseOut(run(edit('Edit', { file_path: 'a.js', new_string: BIG }, { session_id: LADDER }), STATE));
  const h = out && out.hookSpecificOutput;
  assert(h && h.permissionDecision === 'allow', 'expected allow');
  assert(typeof h.additionalContext === 'string' && h.additionalContext.length > 0, 'expected nudge text');
  assert(h.additionalContext.includes('1 non-trivial'), 'nudge must report strike-1 tally');
});

// 4. repeat -> allow + additionalContext (strike 2)
test('4. large Edit again -> allow + nudge (strike 2)', () => {
  const out = parseOut(run(edit('Edit', { file_path: 'a.js', new_string: BIG }, { session_id: LADDER }), STATE));
  const h = out && out.hookSpecificOutput;
  assert(h && h.permissionDecision === 'allow', 'expected allow');
  assert(h.additionalContext.includes('2 non-trivial'), 'nudge must report strike-2 tally');
});

// 5. third -> deny; reason contains the flag-file path
test('5. large Edit third -> deny with flag-file path', () => {
  const out = parseOut(run(edit('Edit', { file_path: 'a.js', new_string: BIG }, { session_id: LADDER }), STATE));
  const h = out && out.hookSpecificOutput;
  assert(h && h.permissionDecision === 'deny', 'expected deny');
  const flag = path.join(STATE, 'enforce', LADDER + '.handson');
  assert(h.permissionDecisionReason.includes(flag), `deny reason must cite ${flag}`);
});

// 6. .handson flag present -> silent allow even for a large Write
test('6. hands-on flag -> silent allow for large Write', () => {
  const sid = uid();
  const dir = path.join(STATE, 'enforce');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, sid + '.handson'), '');
  const res = run(edit('Write', { file_path: 'big.js', content: lines(80) }, { session_id: sid }), STATE);
  assert(res.status === 0 && res.stdout.trim() === '', `expected silent allow, got: ${res.stdout}`);
});

// 7. malformed stdin JSON -> exit 0, no output (fail open)
test('7. malformed stdin -> fail open', () => {
  const res = run('this is not json {{{', STATE);
  assert(res.status === 0 && res.stdout.trim() === '', `expected silent, got: ${res.stdout}`);
});

// 8. missing session_id -> fail open (exit 0)
test('8. missing session_id -> fail open', () => {
  const res = run(edit('Write', { file_path: 'x.js', content: lines(50) }), STATE);
  assert(res.status === 0 && res.stdout.trim() === '', `expected silent, got: ${res.stdout}`);
});

// 9. small edit but to a 2nd distinct file -> strike (nudge)
test('9. small edit to a 2nd distinct file -> nudge', () => {
  const sid = uid();
  const first = run(edit('Edit', { file_path: 'A.js', new_string: 'a\nb' }, { session_id: sid }), STATE);
  assert(first.stdout.trim() === '', 'first small edit must be a silent allow');
  const out = parseOut(run(edit('Edit', { file_path: 'B.js', new_string: 'c\nd' }, { session_id: sid }), STATE));
  const h = out && out.hookSpecificOutput;
  assert(h && h.permissionDecision === 'allow' && h.additionalContext, 'expected a nudge for the 2nd distinct file');
  assert(h.additionalContext.includes('2 distinct'), 'nudge must report 2 distinct files');
});

// 10. argv[2] literally "${CLAUDE_PLUGIN_DATA}" -> falls back to tmpdir and still functions
test('10. unsubstituted ${CLAUDE_PLUGIN_DATA} -> tmp fallback still enforces', () => {
  const out = parseOut(
    run(edit('Write', { file_path: 'x.js', content: lines(50) }, { session_id: uid() }), '${CLAUDE_PLUGIN_DATA}'),
  );
  const h = out && out.hookSpecificOutput;
  assert(h && h.permissionDecision === 'allow' && h.additionalContext, 'expected a strike-1 nudge via tmp fallback');
  const fallback = path.join(os.tmpdir(), 'lask-director-enforce', 'enforce');
  assert(h.additionalContext.includes(fallback), 'flag path must live under the tmp fallback enforce/ dir');
});

// 11. Write and NotebookEdit size measurement paths both exercised
test('11. Write and NotebookEdit measurement paths', () => {
  const outW = parseOut(run(edit('Write', { file_path: 'w.js', content: lines(20) }, { session_id: uid() }), STATE));
  assert(outW.hookSpecificOutput.additionalContext, 'large Write must be measured and nudged');

  const outN = parseOut(
    run(edit('NotebookEdit', { notebook_path: 'n.ipynb', new_source: lines(20) }, { session_id: uid() }), STATE),
  );
  assert(outN.hookSpecificOutput.additionalContext, 'large NotebookEdit new_source must be measured and nudged');

  const small = run(edit('NotebookEdit', { notebook_path: 'n2.ipynb', new_source: 'x\ny' }, { session_id: uid() }), STATE);
  assert(small.stdout.trim() === '', 'small NotebookEdit must be a silent allow');

  const missing = run(edit('NotebookEdit', { notebook_path: 'n3.ipynb' }, { session_id: uid() }), STATE);
  assert(missing.stdout.trim() === '', 'NotebookEdit with missing new_source counts as 0 lines -> silent');
});

// 12. nudge and deny texts contain "lask:implementer" and the tally
test('12. nudge and deny texts carry lask:implementer + tally', () => {
  const sid = uid();
  const nudge = parseOut(run(edit('Edit', { file_path: 'a.js', new_string: BIG }, { session_id: sid }), STATE))
    .hookSpecificOutput.additionalContext;
  assert(/lask:implementer/.test(nudge), 'nudge must name lask:implementer');
  assert(nudge.includes('1 non-trivial') && nudge.includes('1 distinct'), 'nudge must carry the tally');

  run(edit('Edit', { file_path: 'a.js', new_string: BIG }, { session_id: sid }), STATE); // strike 2
  const deny = parseOut(run(edit('Edit', { file_path: 'a.js', new_string: BIG }, { session_id: sid }), STATE))
    .hookSpecificOutput.permissionDecisionReason;
  assert(/lask:implementer/.test(deny), 'deny must name lask:implementer');
  assert(deny.includes('3 non-trivial'), 'deny must carry the strike-3 tally');
});

// 13. cleanup confinement: only old state files INSIDE enforce/ are swept; the shared
//     data BASE and non-state files are left alone.
test('13. cleanup only sweeps old state files inside enforce/', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'lask-enforce-base-'));
  const enforceDir = path.join(base, 'enforce');
  fs.mkdirSync(enforceDir, { recursive: true });
  const old = Date.now() / 1000 - 8 * 24 * 60 * 60; // 8 days ago, seconds for utimesSync
  const unrelated = path.join(base, 'unrelated.dat'); // sibling of enforce/, must survive
  const staleState = path.join(enforceDir, 'stale-sid.json'); // old + matching -> swept
  const staleOther = path.join(enforceDir, 'keep.txt'); // old but non-matching -> survives
  for (const f of [unrelated, staleState, staleOther]) {
    fs.writeFileSync(f, 'x');
    fs.utimesSync(f, old, old);
  }
  const res = run(edit('Edit', { file_path: 'a.js', new_string: 'a\nb' }, { session_id: uid() }), base);
  assert(res.status === 0, `exit ${res.status}`);
  assert(fs.existsSync(unrelated), 'a file at the data BASE (outside enforce/) must survive');
  assert(fs.existsSync(staleOther), 'a non-.json/.handson file inside enforce/ must survive');
  assert(!fs.existsSync(staleState), 'an old .json inside enforce/ must be swept');
  fs.rmSync(base, { recursive: true, force: true });
});

// 14. traversal-shaped session_id is sanitized and cannot escape stateDir.
test('14. traversal session_id sanitized, paths stay inside stateDir', () => {
  const sid = 'a/b..\\c';
  const sanitized = sid.replace(/[^A-Za-z0-9_-]/g, '_');
  const out = parseOut(run(edit('Write', { file_path: 'x.js', content: lines(50) }, { session_id: sid }), STATE));
  const h = out && out.hookSpecificOutput;
  assert(h && h.permissionDecision === 'allow' && h.additionalContext, 'must still nudge normally');
  const flag = path.join(STATE, 'enforce', sanitized + '.handson');
  assert(h.additionalContext.includes(flag), `flag path must be the sanitized, in-dir path ${flag}`);
  assert(fs.existsSync(path.join(STATE, 'enforce', sanitized + '.json')), 'state file must live inside stateDir');
});

// 15. Edit that deletes a large block (empty new_string) is NOT trivial.
test('15. deletion Edit (large old_string, empty new_string) -> strike', () => {
  const out = parseOut(
    run(edit('Edit', { file_path: 'a.js', old_string: lines(50), new_string: '' }, { session_id: uid() }), STATE),
  );
  const h = out && out.hookSpecificOutput;
  assert(h && h.permissionDecision === 'allow' && h.additionalContext, 'a 50-line deletion must strike, not pass as trivial');
});

// 16. 10-line new_string WITH a trailing newline is still trivial (no off-by-one).
test('16. 10-line edit with a trailing newline is trivial', () => {
  const res = run(edit('Edit', { file_path: 'a.js', new_string: lines(10) + '\n' }, { session_id: uid() }), STATE);
  assert(res.status === 0 && res.stdout.trim() === '', `expected silent allow, got: ${res.stdout}`);
});

// 17. NotebookEdit with a non-string new_source must not crash; it counts as 0 lines.
test('17. NotebookEdit with a non-string new_source is lenient (size 0)', () => {
  const res = run(
    edit('NotebookEdit', { notebook_path: 'n.ipynb', new_source: ['a', 'b', 'c'] }, { session_id: uid() }),
    STATE,
  );
  assert(res.status === 0 && res.stdout.trim() === '', `expected silent allow, got: ${res.stdout}`);
});

// 18. A state base path that is actually a FILE -> write fails -> fail open, no output.
test('18. state base occupied by a file -> fail open', () => {
  const asFile = path.join(os.tmpdir(), 'lask-enforce-file-' + uid());
  fs.writeFileSync(asFile, 'not a dir');
  const res = run(edit('Write', { file_path: 'x.js', content: lines(50) }, { session_id: uid() }), asFile);
  assert(res.status === 0 && res.stdout.trim() === '', `expected silent fail-open, got: ${res.stdout}`);
  fs.rmSync(asFile, { force: true });
});

// 19. Corrupt on-disk state resets to a fresh count instead of crashing.
test('19. corrupt on-disk state -> fresh state, no crash', () => {
  const sid = uid();
  const dir = path.join(STATE, 'enforce');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, sid + '.json'), 'not json {{{');
  const out = parseOut(run(edit('Edit', { file_path: 'a.js', new_string: BIG }, { session_id: sid }), STATE));
  const h = out && out.hookSpecificOutput;
  assert(
    h && h.permissionDecision === 'allow' && h.additionalContext.includes('1 non-trivial'),
    'corrupt state must reset to a fresh strike count',
  );
});

try {
  fs.rmSync(STATE, { recursive: true, force: true });
} catch {
  /* best-effort cleanup */
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
