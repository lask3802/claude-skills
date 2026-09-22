---
name: review-loop
description: Use when landing a change that must match an external spec — porting legacy behavior, a migration slice, a protocol or data-format change, or any change whose failure would hide — and when choosing model tiers for spawned agents or workflow scripts. Runs implementer, two isolated adversarial reviewers (Claude and Codex), adjudication, fixer, and a validated judge, with progress kept on disk. Not for exploratory spikes or trivial edits.
---

# Review loop

The unit of quality is the **topology**, not the executor. On a capable main model,
delegating the building buys little; what still pays is review in **separate
contexts** by reviewers who **assume the work is wrong**, and a **judge** that decides
"done" mechanically. (Anthropic's code-migration kit, RUN-NOTES: the catches came
from adversarial review, and the one run that skipped the per-unit review ate that
failure class at compile time. lask 1.x usage: 178 implementer dispatches vs 8
review/verify dispatches — the half that mattered was the half not used.)

## The loop, per unit of work

1. **Spec on disk.** The unit's scope, its spec source (legacy `file:line`, RFC,
   acceptance doc), and acceptance criteria live in a file or a queue row — never
   only in the conversation. A unit is done when its row says so with evidence.
2. **Implement.** The main session or `lask:implementer` builds it and self-tests.
   Which one does not matter much; context isolation does. Dispatch when the unit is
   big enough to pollute the main context or when units run in parallel.
3. **Two reviewers, isolated, in ONE message (parallel):**
   - `lask:reviewer` (Claude) and `lask:second-opinion` (Codex) — two model families.
   - Neither sees the other's verdict, the implementer's report, or your opinion of
     the work. Give each: the diff (or paths), the spec source, the acceptance
     criteria, and "assume it is wrong; every finding cites a spec line, a rule, or a
     failing input".
4. **Adjudicate.** Findings both reviewers raise → confirmed. Findings only one raises
   → check against the cited spec line yourself (or a third isolated reviewer);
   default is **not confirmed**. Record each verdict with its reason. Never
   blanket-accept, never silently drop.
5. **Fix confirmed findings only** — the fixer does not re-review or expand scope.
6. **Judge.** Run the project's gate plus the unit's parity check (oracle, golden
   file, scenario test). Only the judge moves the row to done.

## The judge must be validated before it is trusted

A judge that has never failed is a green light wired to nothing. Before relying on
one: it passes clean on the reference implementation, and it **fails** on at least
one deliberately broken variant (flip a comparison, drop an error path). A judge that
fails everything is usually broken, not right — debug the comparator first.

## Recurring failures move upstream

The same finding class a third time is a rule problem: stop fixing instances, write
the rule into the project's rulebook / `AGENTS.md` / landing skill, and re-run the
units that rule touched. Rule changes are the owner's call, applied between batches,
never by an agent inside the loop.

## Model tiers (what the tiering hooks point at)

| Tier | For |
|---|---|
| `sonnet` / built-in Explore | mechanical, checkable by inspection: inventories, extraction, sweeps |
| `opus` — default | implementation, review, research, synthesis |
| `lask:codex-implementer` | only where a measured comparison showed it beats opus on this kind of task |
| `fable` + written reason | deep multi-constraint judgment in the execution itself — rare |

Stakes buy **more review**, not a bigger executor. Workflow scripts must tier every
`agent()` call (`model:` or a pinned `agentType`); add `tier: reviewed` to bypass a
false positive.

## Reviewer dispatch template

```
You are reviewing, not fixing. Read-only.
Unit: <one line>
Change: <diff command or paths>
Spec: <legacy file:line / doc path — the ground truth>
Acceptance criteria: <numbered>
Assume the change is wrong. Every finding: [critical|major|minor], path:line, the spec
line or rule it violates, and the concrete input -> wrong outcome. No finding without
a citation. "No findings" is a valid answer.
```

## Cost log

One line per unit or batch in the project's cost log (wall clock, tokens, agents,
models). Budgets are multiplications — units x 4 agents x per-agent estimate — not
feelings.
