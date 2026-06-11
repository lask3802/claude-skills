#!/usr/bin/env node
// PreToolUse hook for the Agent/Task tool (subagents and agent-team teammates).
// Policy: spawned agents must not inherit the main-loop model by default.
//   - explicit `model` -> untouched (explicit choice is the gate, including fable)
//   - plugin-namespaced subagent_type (contains ':') -> untouched, its definition governs
//   - Explore -> sonnet (read-only search is mechanical)
//   - everything else -> opus (default workhorse)
// Fail-open: on any error, exit 0 with no output so the tool call proceeds unmodified.
'use strict';

function main(raw) {
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return;
  }
  const input = data && data.tool_input;
  if (!input || typeof input !== 'object' || Array.isArray(input)) return;
  if (input.model) return;
  const type = typeof input.subagent_type === 'string' ? input.subagent_type : '';
  if (type.includes(':')) return;
  const model = type === 'Explore' ? 'sonnet' : 'opus';
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'allow',
        permissionDecisionReason:
          `lask model-tiering: spawned agent defaulted to ${model}. ` +
          'Pass `model` explicitly to override; fable only for explicitly assigned complex tasks.',
        updatedInput: { ...input, model },
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
