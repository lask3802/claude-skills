# Model Tiering for Spawned Agents — Design

Date: 2026-06-11
Status: approved for implementation (autonomous /goal session; requirements specified by user)

## Problem

The main session usually runs on Fable 5, which is powerful but burns tokens fast.
Every spawn path — the Agent tool (subagents, agent-team teammates) and ultracode
Workflow `agent()` calls — **inherits the main-loop model when `model` is omitted**,
and the Workflow tool description explicitly recommends omitting it. Result: fleets
of fable-priced agents doing work that opus or sonnet handles fine.

Desired policy (user-specified):

| Tier | Model | Use for |
|------|-------|---------|
| mechanical | `sonnet` | extraction, formatting, file inventory, simple search, boilerplate |
| **default workhorse** | `opus` (4.8) | implementation, debugging, review, research, synthesis, planning |
| deep judgment | `fable` | ONLY tasks explicitly assigned high-complexity judgment work |

Main-loop model is the user's choice and is never touched. Spawned agents must never
end up on fable *by default* — only by explicit assignment. Overhead must stay minimal.

## Approaches considered

1. **`CLAUDE_CODE_SUBAGENT_MODEL` env var** — one-liner, but it overrides even
   *explicit* per-invocation models, so fable could never be deliberately assigned,
   and there is no per-task tiering. Rejected.
2. **Prompt-only guidance** (skill + injected context, no enforcement) — zero code,
   but the built-in Workflow guidance actively says "omit model", and any forgotten
   `model` param silently inherits fable. Guidance alone leaks. Rejected as sole mechanism.
3. **Hooks + light context (chosen)** — PreToolUse hooks deterministically rewrite or
   reject non-compliant spawns at zero token cost; a small SessionStart context teaches
   tier selection so rejections are rare. Enforcement is mechanical, judgment stays with
   the model.

## Architecture

All inside `plugins/lask/` so the capability ships with plugin install. Pure Node
scripts (no dependencies); Node is required on PATH (true wherever Claude Code is
installed via npm; documented in README).

### 1. SessionStart hook — `hooks/scripts/tier-context.js`

Injects a ~200-token policy block via `hookSpecificOutput.additionalContext`
(matcher `startup|clear|compact`): the tier table, "always pass `model` when
spawning", "set `model` on every Workflow `agent()` call — overrides the default
omit-model guidance", "fable only with stated justification", pointer to the
`lask:model-tiers` skill. This is the only recurring token overhead.

### 2. PreToolUse `^(Agent|Task)$` — `hooks/scripts/tier-agent.js`

Covers subagents and agent-team teammates (tool is `Agent` in current Claude Code,
`Task` in older builds; anchored regex avoids matching `TaskCreate` etc.).

- explicit `model` present → exit 0, untouched (explicitness is the gate — including fable)
- `subagent_type` contains `:` (plugin-namespaced) → untouched; the agent definition's
  own `model` frontmatter governs
- `subagent_type` == `Explore` → `model: "sonnet"` (read-only search is mechanical)
- everything else (omitted type, `claude`, `general-purpose`, `Plan`, bare custom) → `model: "opus"`

Rewrite is emitted as `permissionDecision: "allow"` + `updatedInput` (full input
spread + model). Known trade-offs, accepted: `allow` skips any permission prompt for
the spawn (spawns are auto-approved in practice); a bare custom agent type whose
definition pins a cheap model gets opus instead — passing `model` explicitly always wins.

### 3. PreToolUse `^Workflow$` — `hooks/scripts/tier-workflow.js`

Ultracode dynamic workflows. Whether inner `agent()` spawns also fire the Agent/Task
hook is undocumented, so the script itself is validated (defense in depth — and the
blunt opus default can't tier sonnet work anyway):

- script taken from `tool_input.script`, or read from `tool_input.scriptPath`;
  named workflows / resume-only invocations → pass
- bypass marker `tier: reviewed` in a comment → pass (escape hatch so a false
  positive can never deadlock)
- otherwise: mask string literals and comments (single-pass lexer handling `'` `"`
  backticks with `${}` interpolation, `//`, `/* */`), find `agent(` call sites,
  balance parens to capture each call span, and treat a call as compliant if the
  span contains `model:`, `agentType:` (pinned-model agent), or a `...` spread
  (opts not statically known)
- any non-compliant call → `permissionDecision: "deny"` with a reason that restates
  the three tiers, quotes the first offending call, and names the bypass marker —
  the main model rewrites the script in one round trip
- any internal error or unreadable file → exit 0 (fail-open)

### 4. Skill — `skills/model-tiers/SKILL.md`

On-demand full rubric: tier decision examples, how the hooks behave, how to
legitimately assign fable (explicit `model: 'fable'` + justification in the agent
prompt), mixed-tier ultracode patterns (sonnet finders → opus verifiers → fable
synthesis only when warranted).

## Failure modes

| Failure | Behavior |
|---------|----------|
| node not on PATH | hook command fails non-blocking; Claude Code proceeds unmodified (plugin degrades to no-op, never breaks spawning) |
| malformed hook stdin | exit 0, pass-through |
| `scriptPath` unreadable | exit 0, pass-through |
| lexer false positive on a compliant script | deny message includes `/* tier: reviewed */` bypass |

## Testing

`plugins/lask/hooks/scripts/tier.test.js` — plain Node test runner piping sample
PreToolUse JSON into each script via `child_process`, asserting stdout/exit codes.
Run: `node plugins/lask/hooks/scripts/tier.test.js`. No framework, no deps.

## Out of scope

- Changing or capping the main-loop model.
- Verifying fable justifications (explicit assignment is the gate).
- The `claude` model alias map (aliases `sonnet`/`opus`/`fable` track latest releases).
