#!/usr/bin/env node
// PreToolUse hook for the Workflow tool (ultracode dynamic workflows).
// Policy: every agent() call in a workflow script must carry
//   1. an explicit model tier (model: 'opus' | 'sonnet', or 'haiku' for pure relays) or an
//      agentType, so workflow agents never silently inherit the main-loop model; fable is
//      retired, so a literal model: 'fable' is a violation too; and
//   2. an explicit effort (low | medium | high | xhigh | max), unless its agentType is a lask
//      agent whose definition pins one, so coding and bulk work never silently inherit an
//      xhigh/ultracode session effort. An agent() effort overrides a definition's pin
//      (measured 2026-09-26: lask:scout, pinned medium, ran at high with effort: 'high').
//
// A call is compliant when its argument span satisfies both, or contains an object spread
// (`...` — opts not statically knowable).
// Escape hatch for false positives: a comment containing `tier: reviewed`.
// Fail-open: on any error (bad JSON, unreadable scriptPath), exit 0 with no output.
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const EFFORTS = new Set(['low', 'medium', 'high', 'xhigh', 'max']);

// name -> pinned effort, read from this plugin's own agent definitions so the hook and the
// frontmatter cannot drift. Unreadable -> no pins (stricter: every call then needs effort:).
function pinnedEfforts() {
  const pins = new Map();
  try {
    const dir = path.join(__dirname, '..', '..', 'agents');
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.md')) continue;
      const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(fs.readFileSync(path.join(dir, f), 'utf8'));
      if (!fm) continue;
      const name = /^name:\s*(\S+)\s*$/m.exec(fm[1]);
      const effort = /^effort:\s*(\S+)\s*$/m.exec(fm[1]);
      if (name && effort && EFFORTS.has(effort[1])) pins.set(name[1], effort[1]);
    }
  } catch {
    /* no pins */
  }
  return pins;
}

// Ranges [a, b) of `masked` split at commas outside (), [] and {}. Strings and comments are
// already blanked in `masked`, so their commas and brackets never count.
function splitTopLevel(masked, from, to) {
  const parts = [];
  let depth = 0;
  let start = from;
  for (let i = from; i < to; i++) {
    const c = masked[i];
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    else if (c === ',' && depth === 0) {
      parts.push([start, i]);
      start = i + 1;
    }
  }
  parts.push([start, to]);
  return parts.filter(([a, b]) => masked.slice(a, b).trim() !== '');
}

// Shrink [a, b) past whitespace in `masked` — which is also where comments went.
function trimRange(masked, a, b) {
  while (a < b && /\s/.test(masked[a])) a++;
  while (b > a && /\s/.test(masked[b - 1])) b--;
  return [a, b];
}

// The options of one agent() call: only the TOP-LEVEL properties of its last argument, and only
// when that argument is an object literal. Nested objects (a `schema` with an `effort` property,
// `data: [...xs]`) never count. Returns { kind: 'none' | 'opaque' | 'object', props, spread },
// where props maps a key to its value's source text (comments trimmed), and a shorthand
// `{ effort }` maps to the identifier itself.
function topLevelOptions(src, masked, argStart, argEnd) {
  const props = new Map();
  const args = splitTopLevel(masked, argStart, argEnd);
  if (args.length < 2) return { kind: 'none', props, spread: false };
  const [a, b] = trimRange(masked, ...args[args.length - 1]);
  if (masked[a] !== '{' || masked[b - 1] !== '}') return { kind: 'opaque', props, spread: false };
  let spread = false;
  for (const range of splitTopLevel(masked, a + 1, b - 1)) {
    const [pa, pb] = trimRange(masked, ...range);
    const text = src.slice(pa, pb);
    if (text.startsWith('...')) {
      spread = true;
      continue;
    }
    const k = /^(?:(['"])([A-Za-z_$][\w$]*)\1|([A-Za-z_$][\w$]*))\s*(:)?/.exec(text);
    if (!k) continue;
    const key = k[2] || k[3];
    if (!k[4]) {
      if (/^[A-Za-z_$][\w$]*$/.test(text)) props.set(key, key); // shorthand; methods are skipped
      continue;
    }
    const [va, vb] = trimRange(masked, pa + k[0].length, pb);
    props.set(key, src.slice(va, vb));
  }
  return { kind: 'object', props, spread };
}

// The string a value denotes when it is exactly one string literal; null for any expression
// (a variable, a ternary, a concatenation, a template with `${}`).
function literalValue(v) {
  if (!v || v.length < 2) return null;
  const q = v[0];
  if (!`'"\``.includes(q) || v[v.length - 1] !== q) return null;
  const body = v.slice(1, -1);
  if (q === '`' && body.includes('${')) return null;
  for (let i = 0; i < body.length; i++) {
    if (body[i] === '\\') i++;
    else if (body[i] === q) return null; // `'a' + 'b'`: two literals, an expression
  }
  return body.replace(/\\(.)/g, '$1');
}

// Replace the contents of string literals and comments with spaces, preserving
// indices, so agent( inside prompts/comments never matches and paren balancing
// only sees real code. Handles ' " ` (with ${} interpolation), // and /* */.
function maskCode(src) {
  const out = src.split('');
  const n = src.length;
  const stack = []; // {type:'template'} | {type:'interp', depth:number}
  let i = 0;
  while (i < n) {
    const c = src[i];
    const d = i + 1 < n ? src[i + 1] : '';
    const top = stack.length ? stack[stack.length - 1] : null;

    if (top && top.type === 'template') {
      if (c === '\\') {
        out[i] = ' ';
        if (i + 1 < n) out[i + 1] = ' ';
        i += 2;
        continue;
      }
      if (c === '`') {
        stack.pop();
        i++;
        continue;
      }
      if (c === '$' && d === '{') {
        stack.push({ type: 'interp', depth: 0 });
        i += 2;
        continue;
      }
      out[i] = ' ';
      i++;
      continue;
    }

    // code (possibly inside a template interpolation)
    if (c === '/' && d === '/') {
      while (i < n && src[i] !== '\n') {
        out[i] = ' ';
        i++;
      }
      continue;
    }
    if (c === '/' && d === '*') {
      out[i] = ' ';
      out[i + 1] = ' ';
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) {
        out[i] = ' ';
        i++;
      }
      if (i < n) {
        out[i] = ' ';
        out[i + 1] = ' ';
        i += 2;
      }
      continue;
    }
    if (c === "'" || c === '"') {
      const q = c;
      i++;
      while (i < n && src[i] !== q && src[i] !== '\n') {
        if (src[i] === '\\') {
          out[i] = ' ';
          i++;
          if (i < n) {
            out[i] = ' ';
            i++;
          }
          continue;
        }
        out[i] = ' ';
        i++;
      }
      i++; // closing quote (kept)
      continue;
    }
    if (c === '`') {
      stack.push({ type: 'template' });
      i++;
      continue;
    }
    if (top && top.type === 'interp') {
      if (c === '{') top.depth++;
      else if (c === '}') {
        if (top.depth === 0) {
          stack.pop();
          i++;
          continue;
        }
        top.depth--;
      }
    }
    i++;
  }
  return out.join('');
}

function findViolations(src, pins = pinnedEfforts()) {
  const masked = maskCode(src);
  const re = /(?<![\w.$])agent\s*\(/g;
  const violations = [];
  let m;
  while ((m = re.exec(masked))) {
    const openIdx = m.index + m[0].length - 1;
    let depth = 1;
    let j = openIdx + 1;
    while (j < masked.length && depth > 0) {
      if (masked[j] === '(') depth++;
      else if (masked[j] === ')') depth--;
      j++;
    }
    const opts = topLevelOptions(src, masked, openIdx + 1, j - 1);
    const { props, spread } = opts;
    const untiered = !props.has('model') && !props.has('agentType') && !spread;
    // The model's whole value expression counts, so `c ? 'fable' : 'opus'` is caught.
    const fable = props.has('model') && /fable/i.test(props.get('model'));
    // effort: explicit value (a literal must be a real level; an expression is trusted), or a
    // lask agentType whose definition pins one.
    const effortValue = props.has('effort') ? props.get('effort') : null;
    const effortLiteral = literalValue(effortValue);
    const badEffort = effortLiteral !== null && !EFFORTS.has(effortLiteral);
    const agentType = literalValue(props.get('agentType'));
    const pinned = agentType !== null && agentType.startsWith('lask:') && pins.has(agentType.slice(5));
    const noEffort = effortValue === null && !pinned && !spread;
    if (untiered || fable || noEffort || badEffort) {
      const why = [
        untiered && 'no model tier',
        fable && 'fable',
        noEffort && 'no effort',
        badEffort && `effort '${effortLiteral}' is not a level`,
      ].filter(Boolean).join(', ');
      const snippet = src.slice(m.index, Math.min(j, m.index + 160)).replace(/\s+/g, ' ');
      violations.push(`${snippet} (${why})`);
    }
  }
  return violations;
}

function main(raw) {
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return;
  }
  const input = data && data.tool_input;
  if (!input || typeof input !== 'object') return;

  let script = null;
  if (typeof input.scriptPath === 'string' && input.scriptPath) {
    try {
      script = fs.readFileSync(input.scriptPath, 'utf8');
    } catch {
      return; // unreadable -> fail open
    }
  } else if (typeof input.script === 'string') {
    script = input.script;
  }
  if (!script) return; // named workflow / resume-only -> nothing to check

  if (/tier:\s*reviewed/i.test(script)) return; // explicit bypass marker

  const pins = pinnedEfforts();
  const violations = findViolations(script, pins);
  if (!violations.length) return;
  const pinnedList = [...pins.keys()].sort().map((n) => `lask:${n}`).join(', ') || 'none found';

  const reason =
    `lask model-tiering: ${violations.length} agent() call(s) in this workflow script lack an explicit model tier or effort, or use fable. ` +
    "Rewrite the script so EVERY agent() call sets model: 'opus' (default: implementation, review, research, synthesis) " +
    "or model: 'sonnet' (mechanical only: extraction, formatting, simple search) — fable is retired for subagents, use opus — " +
    "AND effort by role: research, synthesis, spec/design writing 'xhigh' is fine; implementation, coding, fixes 'high'; " +
    "bulk low-level work (inventories, classification drafts, extraction, sweeps, mechanical edits, format/citation checks) 'medium'; " +
    `review 'high'; recon and verification 'medium'; relays 'low'. A lask agentType whose definition pins effort (${pinnedList}) ` +
    'satisfies the effort rule; an explicit effort overrides the pin. Only top-level options of the last argument count. ' +
    `First offending call: \`${violations[0]}\`. ` +
    'If this is a false positive, add a comment containing `tier: reviewed` at the top of the script. ' +
    'Full rubric: skill lask:review-loop.';

  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: reason,
      },
    }),
  );
}

if (require.main === module) {
  let raw = '';
  process.stdin.on('data', (c) => (raw += c));
  process.stdin.on('end', () => {
    try {
      main(raw);
    } catch {
      /* fail open */
    }
    process.exit(0);
  });
} else {
  // For tests: the parser with injectable pins, and the frontmatter reader.
  module.exports = { findViolations, pinnedEfforts, EFFORTS };
}
