---
name: fan-out
description: Use when one question or change applies to many independent units — audit every service, sweep every endpoint, migrate every call site, check every inventory row — and each unit can be judged without the others. One subagent per unit in parallel waves, evidence checked before acceptance, one table at the end. Not for a handful of units you can do inline.
---

# Fan-out

Breadth work goes wrong in two ways: one context tries to hold every unit and starts
skimming, or subagents report verdicts that nobody checks. Here each unit gets its own
context, and nothing is accepted on a subagent's word alone.

## 1. Inventory on disk

Enumerate the units mechanically (glob, grep, a query, a script) — never from memory — and
write one checklist row per unit to `TASKS.md` (or the project's own queue file) under the
contract from `lask:long-run`. State the count. If the count surprises you, the selector is
probably wrong; fix it before dispatching anything.

Budget before launching: units x per-agent estimate. Past about 30 agents, say the number
and the tier in one line and go on unless the task set a limit.

## 2. One brief, identical for every unit

Write it to a file. Only the unit id changes between dispatches.

```
Unit: <id>            (the only line that differs between agents)
Question: <exactly what to decide or change for this unit>
Ground truth: <spec, issue, legacy file:line — what "affected" means>
Scope: read-only | may edit only files under <unit path>
Report these three fields (inside your report protocol's sections if your agent has one:
verdict under Verdict, evidence under Evidence, the rest under Self-assessment):
  verdict: <yes | no | changed | blocked>
  evidence: <path:line you opened, or command + the output line that decides it>
  could not confirm: <what you could not check, and where you looked>
No verdict without evidence you actually opened or ran.
```

## 3. Dispatch in waves

- One subagent per unit, a whole wave launched in ONE message so it runs in parallel.
  Waves of about 8. Launch them with `run_in_background` so you can check each report as it
  lands and start the next wave without waiting for the slowest agent.
- Tier by the work, not by the stakes (the tiering hooks enforce a tier on every spawn):
  `lask:scout` or Explore for read-only lookups, `model: "sonnet"` for mechanical checks,
  `lask:implementer` (opus) for units that edit code.
- Parallel writers on one repository get `isolation: "worktree"`, or partition the files
  so no two units touch the same one.
- The `Workflow` tool is for users who opted in to multi-agent orchestration (ultracode).
  Then the same shape becomes a `pipeline()` whose every `agent()` sets `model:`.

## 4. Check the evidence before accepting

A subagent's report is a claim. For each one:

- **Positive verdicts** (affected, changed): open the cited line or re-run the cited
  command yourself. Accept only if it shows what the report says.
- **Negative verdicts**: spot-check a sample, at least one in five and every one whose
  evidence is thin.
- **No evidence, or evidence that does not show the claim**: re-dispatch that unit once,
  naming the gap. A second failure: do the unit yourself or mark it blocked. Never
  average it in.
- Record each accepted verdict with its evidence in the checklist as you go, so a
  compaction loses nothing.

Code changes that must match an external spec do not end at step 4: each goes through
`lask:review-loop`. Other code changes get a `lask:verifier` run against the unit's
acceptance criteria.

## 5. One table

```
| Unit | Verdict | Evidence | Could not confirm |
|------|---------|----------|-------------------|
```

Every unit appears exactly once, blocked ones included. Then the usual end-of-run headings:
`Blocked on me`, `Changed`, `Found`. Counts in `Found` must add up to the inventory count.
