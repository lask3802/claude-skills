#!/usr/bin/env node
// PreToolUse hook for the Agent/Task tool (subagents and agent-team teammates).
// Policy: spawned agents run on opus; sonnet only for mechanical work; no fable.
//   - explicit fable -> opus (fable subagents are retired: Opus 5.5 is the better buy)
//   - any other explicit `model` -> untouched (explicit choice is the gate)
//   - model "inherit" counts as unset (it would hand down the main-loop model)
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
  const type = typeof input.subagent_type === 'string' ? input.subagent_type : '';
  // `inherit` would hand the main-loop model (possibly fable) down: treat it as unset.
  const inherit = /^inherit$/i.test(String(input.model || ''));
  const { model: _dropped, ...rest } = input;
  let updatedInput;
  let why;
  if (input.model && !inherit) {
    if (!/fable/i.test(String(input.model))) return;
    updatedInput = { ...input, model: 'opus' };
    why = 'fable subagents are retired, so this spawn runs on opus.';
  } else if (type.includes(':')) {
    if (!inherit) return;
    updatedInput = rest; // the plugin agent's own definition governs
    why = 'model "inherit" dropped; the agent definition picks the model.';
  } else {
    const model = type === 'Explore' ? 'sonnet' : 'opus';
    updatedInput = { ...rest, model };
    why = `spawned agent defaulted to ${model}. Pass \`model: "sonnet"\` only for mechanical work.`;
  }
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'allow',
        permissionDecisionReason: `lask model-tiering: ${why}`,
        updatedInput,
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
