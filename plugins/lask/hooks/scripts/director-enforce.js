#!/usr/bin/env node
// PreToolUse hook for MAIN-SESSION direct file edits (Edit/Write/NotebookEdit).
// Director-mode v2 enforcement: the main session spends its scarce capability on
// judgment and dispatches implementation labor; hands-on edits beyond a trivial
// allowance are first nudged, then denied — with a per-session escape hatch.
//   - subagent calls (agent_id present)          -> silent allow (labor is the path)
//   - hands-on flag file present for the session -> silent allow (authorized escape)
//   - trivial edit (<=10 lines, <=1 distinct file so far) -> silent allow, no strike
//   - otherwise strike++: strikes 1..2 -> allow + factual additionalContext nudge
//                         strikes  >=3  -> deny with a factual, retryable reason
// Fail-open: ANY error (bad JSON, missing fields, fs/unwritable-state errors) exits 0
// with no output, so a broken hook degrades to no policy, never to blocked editing.
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const MAX_TRIVIAL_LINES = 10; // an edit at or below this many lines can be direct...
const FREE_FILES = 1;         // ...to at most this many distinct files per session
const NUDGE_STRIKES = 2;      // strikes 1..NUDGE_STRIKES nudge; beyond that, deny
const STATE_TTL_DAYS = 7;     // opportunistically drop session state older than this

function lineCount(s) {
  if (typeof s !== 'string') return 0; // missing / non-string field -> 0 lines
  // Strip ONE trailing newline so a 10-line block ending in "\n" counts as 10, not 11.
  return s.replace(/\r\n$|\r$|\n$/, '').split(/\r\n|\r|\n/).length;
}

function measure(toolName, input) {
  // Edit: count the larger of removed vs added lines, so a large deletion is not trivial.
  if (toolName === 'Edit') return Math.max(lineCount(input.old_string), lineCount(input.new_string));
  if (toolName === 'Write') return lineCount(input.content);
  if (toolName === 'NotebookEdit') return lineCount(input.new_source);
  return 0;
}

function cleanup(stateDir) {
  try {
    const cutoff = Date.now() - STATE_TTL_DAYS * 24 * 60 * 60 * 1000;
    for (const name of fs.readdirSync(stateDir)) {
      if (!/\.(json|handson)$/.test(name)) continue; // only ever touch our own state files
      const p = path.join(stateDir, name);
      try {
        if (fs.statSync(p).mtimeMs < cutoff) fs.unlinkSync(p);
      } catch {
        /* best-effort per file */
      }
    }
  } catch {
    /* best-effort */
  }
}

function main(raw) {
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return; // fail open on malformed stdin
  }
  // Subagent labor is the intended path: agent_id is present ONLY inside a subagent call.
  if (data && data.agent_id) return;

  let sessionId = data && typeof data.session_id === 'string' ? data.session_id : '';
  if (!sessionId) return; // no session key -> fail open
  // Sanitize before any filename use: a traversal-shaped id must not escape stateDir.
  sessionId = sessionId.replace(/[^A-Za-z0-9_-]/g, '_');

  const input = data.tool_input;
  if (!input || typeof input !== 'object' || Array.isArray(input)) return;

  // Base dir from argv[2] (hooks.json passes ${CLAUDE_PLUGIN_DATA}); fall back to tmp when
  // it is missing, empty, or an unsubstituted "${...}" literal. Own a dedicated 'enforce'
  // subdirectory so cleanup never sweeps unrelated plugin data at the shared data root.
  let base = process.argv[2];
  if (!base || base.includes('${')) {
    base = path.join(os.tmpdir(), 'lask-director-enforce');
  }
  const stateDir = path.join(base, 'enforce');
  try {
    fs.mkdirSync(stateDir, { recursive: true });
  } catch {
    /* best-effort; a genuinely unwritable dir fails open at the write below */
  }

  // Hands-on escape hatch: a flag file for this session disables enforcement.
  const flag = path.join(stateDir, sessionId + '.handson');
  if (fs.existsSync(flag)) return;

  const toolName = typeof data.tool_name === 'string' ? data.tool_name : '';
  const size = measure(toolName, input);
  const fileId =
    typeof input.file_path === 'string'
      ? input.file_path
      : typeof input.notebook_path === 'string'
      ? input.notebook_path
      : '';

  // Load per-session state, fold in this file, decide.
  const statePath = path.join(stateDir, sessionId + '.json');
  let state = { files: [], strikes: 0 };
  try {
    const parsed = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    if (parsed && Array.isArray(parsed.files)) state.files = parsed.files.slice();
    if (parsed && Number.isFinite(parsed.strikes)) state.strikes = parsed.strikes;
  } catch {
    /* no prior (or unreadable) state -> start fresh */
  }
  if (fileId && !state.files.includes(fileId)) state.files.push(fileId);
  const distinct = state.files.length;

  const trivial = size <= MAX_TRIVIAL_LINES && distinct <= FREE_FILES;
  if (!trivial) state.strikes += 1;

  // Persist. A genuinely unwritable state dir throws here and fails open (no output).
  fs.writeFileSync(statePath, JSON.stringify(state));

  if (!trivial) {
    if (state.strikes <= NUDGE_STRIKES) {
      process.stdout.write(
        JSON.stringify({
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'allow',
            additionalContext:
              `lask director-mode note: this session has recorded ${state.strikes} non-trivial ` +
              `direct file edit(s) across ${distinct} distinct file(s). Under the policy, trivial ` +
              `single-file edits (≤10 lines) are within the director's remit, while larger ` +
              `implementation is normally dispatched to lask:implementer. The existence of the flag ` +
              `file ${flag} enables hands-on mode for this session, appropriate only when the user ` +
              `has authorized hands-on work.`,
          },
        }),
      );
    } else {
      process.stdout.write(
        JSON.stringify({
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'deny',
            permissionDecisionReason:
              `lask director-mode: this session has recorded ${state.strikes} non-trivial direct ` +
              `file edits across ${distinct} distinct file(s), beyond the director's trivial ` +
              `single-file allowance (≤10 lines). Larger implementation is normally the remit ` +
              `of lask:implementer. This blocked call remains available for retry once the work has ` +
              `been dispatched, or once hands-on mode is enabled by the existence of the flag file ` +
              `${flag}, appropriate only when the user has authorized hands-on work.`,
          },
        }),
      );
    }
  }

  cleanup(stateDir);
}

let raw = '';
process.stdin.on('data', (c) => (raw += c));
process.stdin.on('error', () => process.exit(0)); // a stream error must never exit non-zero
process.stdin.on('end', () => {
  try {
    main(raw);
  } catch {
    /* fail open */
  }
  process.exit(0);
});
