---
name: model-tiers
description: Use when spawning agents (Agent tool, agent-team teammates, Workflow/ultracode agent() calls) and choosing the model parameter, when the tier-policy hook denies a workflow script, or when tempted to assign fable to a spawned agent.
---

# Model Tiers for Spawned Agents

## Overview

Capability follows the TASK, not the parent. The main loop may run fable; spawned
agents never inherit it by default — an expensive model on a routine task buys
nothing but token burn.

## Tier table

| Tier | Model | Assign when |
|------|-------|-------------|
| mechanical | `sonnet` | Output verifiable by inspection, little judgment: renames, extraction, formatting, file/endpoint inventories, search sweeps, boilerplate, status checks |
| workhorse — DEFAULT | `opus` | Normal engineering judgment: implementation (incl. tests), debugging, code review, research, planning, moderate synthesis |
| deep judgment | `fable` | Explicitly assigned high-complexity reasoning: many interacting constraints, adversarial stress-testing of subtle claims, final synthesis over large evidence |

## Decision rules

- Unsure between sonnet and opus → opus.
- Unsure between opus and fable → opus. fable requires BOTH a task that genuinely
  needs deep multi-constraint judgment AND a stated justification in the agent
  prompt ("This needs fable because ...").
- "Implementation/debugging requires deep reasoning" does NOT make it fable —
  that is opus's job and opus is strong. Quality comes from verification
  structure (more checkers), not bigger finders.
- haiku is fine below sonnet for trivial lookups, but sonnet is the safe
  mechanical default.

| Rationalization | Reality |
|-----------------|---------|
| "Complex feature, use fable to be safe" | Implementation is workhorse-tier. opus. |
| "Flaky bug needs deepest model" | Debugging is systematic, not exotic. opus. |
| "High stakes, so fable" | Stakes ≠ complexity. Add verification agents instead. |

## Enforcement (hooks shipped with this plugin)

- Agent/Task spawn without `model` → hook rewrites it: Explore→sonnet, others→opus.
  Plugin-namespaced agent types (`x:y`) keep their definition's model. Explicit
  `model` is always respected — including a justified fable.
- Workflow scripts: EVERY `agent()` call needs `model:` (or a pinned `agentType`),
  overriding the Workflow tool's "omit model" guidance; violations are denied with
  instructions. Only for a false positive, add a comment containing `tier: reviewed`.

## Ultracode mixed-tier example

```js
const found = await parallel(FINDERS.map(f => () =>
  agent(f.prompt, { phase: 'Find', model: 'sonnet', schema: BUGS })))   // mechanical sweep
const verified = await parallel(bugs.map(b => () =>
  agent(verify(b), { phase: 'Verify', model: 'opus', schema: VERDICT }))) // per-finding judgment
const report = await agent(
  `Synthesize ${bugs.length} verified findings into one strategy. This needs fable because the trade-offs interact across subsystems and the evidence base is large.`,
  { model: 'fable', schema: REPORT })                                     // justified, explicit
```
