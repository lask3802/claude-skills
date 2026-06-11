#!/usr/bin/env node
// SessionStart hook: inject the spawned-agent model-tiering policy as context.
// Kept deliberately compact — this is the plugin's only recurring token overhead.
'use strict';

const context = `<lask-model-tiering-policy>
Spawned-agent model tiering is ACTIVE (lask plugin; enforced by hooks). The main session may run on an expensive model (e.g. fable) — spawned agents must NOT inherit it by default.

Tiers — pick per task when spawning ANY agent (Agent tool, agent-team teammates, Workflow agent() calls):
- sonnet: mechanical, low-judgment work — extraction, formatting, file inventory, simple search sweeps, boilerplate edits, status checks.
- opus: DEFAULT workhorse — implementation, debugging, code review, research, planning, synthesis.
- fable: ONLY for tasks explicitly assigned deep multi-constraint judgment (subtle architectural trade-offs, adversarial verification of subtle claims, final synthesis over large evidence). State the justification in the agent prompt.

Rules:
1. Agent tool: pass \`model\` explicitly. If omitted, a hook rewrites it (Explore -> sonnet, everything else -> opus). Plugin-namespaced agent types (name contains ':') are left to their own definitions.
2. Workflow (ultracode) scripts: set \`model\` (or a pinned agentType) on EVERY agent() call — this deliberately OVERRIDES the Workflow tool's "default to omitting model" guidance. A hook rejects scripts with untier-ed agent() calls; fix by adding models. Only for a false positive, add a comment containing \`tier: reviewed\`.
3. Never assign fable by default or "to be safe". Explicit model choices are always respected, so a deliberate model:'fable' on a genuinely complex task is fine.

The main-loop model is the user's choice and is not affected. Full rubric: skill lask:model-tiers.
</lask-model-tiering-policy>`;

let raw = '';
process.stdin.on('data', (c) => (raw += c));
process.stdin.on('end', () => {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext: context,
      },
    }),
  );
  process.exit(0);
});
