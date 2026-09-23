#!/usr/bin/env node
// SessionStart hook (matcher: compact). After a context compaction, point the session back
// at the run's checklist so the summary never replaces it as the state of a long run.
// Silent unless a lask:long-run TASKS.md (it carries a `Done means:` line) with open items
// exists in the working directory or a parent up to the project root. The nearest live one
// wins. One pointer, no policy.
// Fail-open: on any error, exit 0 with no output.
'use strict';

const fs = require('node:fs');
const path = require('node:path');

// Checkbox counts outside fenced code blocks.
function counts(src) {
  const text = src.replace(/^(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1[^\n]*$/gm, '');
  return {
    open: (text.match(/^\s*[-*] \[ \]/gm) || []).length,
    done: (text.match(/^\s*[-*] \[[xX]\]/gm) || []).length,
    contract: /^\s*(?:[-*>]\s+)?(?:\*\*|__)?Done means:/im.test(text),
  };
}

// cwd, then each parent up to the git root or CLAUDE_PROJECT_DIR (whichever comes first).
function candidates(cwd) {
  const stop = process.env.CLAUDE_PROJECT_DIR ? path.resolve(process.env.CLAUDE_PROJECT_DIR) : null;
  const dirs = [];
  let dir = path.resolve(cwd);
  for (let n = 0; n < 12; n++) {
    dirs.push(dir);
    if (dir === stop || fs.existsSync(path.join(dir, '.git'))) break;
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return dirs;
}

function main(raw) {
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return;
  }
  const cwd = data && typeof data.cwd === 'string' && data.cwd ? data.cwd : process.cwd();
  for (const dir of candidates(cwd)) {
    const file = path.join(dir, 'TASKS.md');
    let src;
    try {
      src = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    const c = counts(src);
    if (!c.contract || !c.open) continue; // not a live long-run file: keep looking toward the root
    const context =
      `lask long-run: the context was just compacted. This run's checklist is ${file} ` +
      `(${c.open} open, ${c.done} done). Re-read it before the next action; the file, not the summary, is the state.`;
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: context } }));
    return;
  }
}

module.exports = { counts };

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
}
