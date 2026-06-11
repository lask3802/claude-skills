#!/usr/bin/env node
// PreToolUse hook for the Workflow tool (ultracode dynamic workflows).
// Policy: every agent() call in a workflow script must carry an explicit model tier
// (model: 'sonnet' | 'opus' | 'fable') or a pinned agentType, so workflow agents
// never silently inherit the expensive main-loop model.
//
// A call is compliant when its argument span contains `model:`, `agentType:`,
// or an object spread (`...` — opts not statically knowable).
// Escape hatch for false positives: a comment containing `tier: reviewed`.
// Fail-open: on any error (bad JSON, unreadable scriptPath), exit 0 with no output.
'use strict';

const fs = require('node:fs');

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

function findViolations(src) {
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
    const span = masked.slice(openIdx + 1, j - 1);
    if (!/\bmodel\s*:/.test(span) && !/\bagentType\s*:/.test(span) && !span.includes('...')) {
      const snippet = src.slice(m.index, Math.min(j, m.index + 160)).replace(/\s+/g, ' ');
      violations.push(snippet);
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

  const violations = findViolations(script);
  if (!violations.length) return;

  const reason =
    `lask model-tiering: ${violations.length} agent() call(s) in this workflow script have no explicit model tier. ` +
    "Rewrite the script so EVERY agent() call sets model: 'sonnet' (mechanical: extraction, formatting, simple search), " +
    "model: 'opus' (default: implementation, review, research, synthesis), or model: 'fable' (ONLY for explicitly assigned " +
    'deep-judgment tasks — justify in the agent prompt). An agentType with a pinned model also satisfies this. ' +
    `First offending call: \`${violations[0]}\`. ` +
    'If this is a false positive, add a comment containing `tier: reviewed` at the top of the script.';

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
