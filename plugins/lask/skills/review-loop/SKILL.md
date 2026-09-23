---
name: review-loop
description: Use when landing a change that must match an external spec — porting legacy behavior, a migration slice, a protocol or data-format change, or any change whose failure would hide — and when choosing model tiers for spawned agents or workflow scripts. Runs implementer, two or more isolated adversarial reviewers from different model families, adjudication, fixer, and a validated judge, with progress kept on disk. Not for exploratory spikes or trivial edits.
---

# Review loop

The unit of quality is the **topology**, not the executor. On a capable main model,
delegating the building buys little; what still pays is review in **separate
contexts** by reviewers who **assume the work is wrong**, and a **judge** that decides
"done" mechanically.

Evidence (validation run, dragonraja-rebon `migration/experiments/2026-09-23-inventory-20/`):
an Opus 5.5 draft of 20 porting-inventory rows passed all of its own acceptance
criteria and a 121-citation mechanical check, yet carried **25 distinct defects, 5 of
them material** (wrong legacy behavior or wrong port status). The main session's own
spot check found 3. Three isolated reviewers — Claude, Meta Muse, Xiaomi MiMo, same
prompt — found 15, 8 and 11; their union found 24. Each family had confirmed catches
no other family made. 35 findings, 31 confirmed, 4 partial, **0 rejected**.
(Also: Anthropic's code-migration kit RUN-NOTES; lask 1.x usage — 178 implementer vs 8
review/verify dispatches, i.e. the half that pays was the half not used.)

## The loop, per unit of work

1. **Spec on disk.** The unit's scope, its spec source (legacy `file:line`, RFC,
   acceptance doc), and acceptance criteria live in a file or a queue row — never
   only in the conversation. A unit is done when its row says so with evidence.
2. **Implement.** The main session or `lask:implementer` builds it and self-tests.
   Which one does not matter much; context isolation does. Dispatch when the unit is
   big enough to pollute the main context or when units run in parallel.
3. **Reviewers, isolated, launched together (ONE message / parallel):**
   - **At least two, from different model families; three when a miss is expensive.**
     The best single reviewer in the validation run found 60% of the defects.
   - Claude: `lask:reviewer`. Second family: `lask:second-opinion` (Codex), or any
     headless agent CLI in a read-only mode — see `second-family.md` in this skill's
     directory for tested recipes, time boxes, and how to recover output.
   - Every reviewer gets the **identical** brief (template below) and nothing else:
     not the other reviews, not the implementer's report, not your opinion of the work.
4. **Adjudicate — the main session's job, not a substitute for a reviewer.** Check each
   finding against the line it cites; verdict CONFIRMED / PARTIAL / REJECTED with the
   reason. A finding only one reviewer raises is not confirmed until you have read the
   cited line. Never blanket-accept, never silently drop. Writing your own quick pass
   down *before* reading the reviews keeps you honest, but do not count it as a review.
5. **Fix confirmed findings only** — the fixer does not re-review or expand scope.
   PARTIALs that are convention questions become a `TODO(port)`/owner question, not an
   edit.
6. **Judge.** Run the project's gate plus the unit's parity check (oracle, golden
   file, scenario test). Only the judge moves the row to done.

## The judge must be validated before it is trusted

A judge that has never failed is a green light wired to nothing. Before relying on
one: it passes clean on the reference implementation, and it **fails** on at least
one deliberately broken variant (flip a comparison, drop an error path). A judge that
fails everything is usually broken, not right — debug the comparator first.

The same goes for every test a unit *cites* as its judge. In the validation run the
judge column was the one systematic blind spot: tests cited as pinning a rule turned
out to be proptest driver steps (`let _ = op(...)`) or invariants that pass with the
rule deleted. Hence the mutation question in the reviewer brief.

## Recurring failures move upstream

The same finding class a third time is a rule problem: stop fixing instances, write
the rule into the project's rulebook / `AGENTS.md` / landing skill, and re-run the
units that rule touched. Findings that are really "the schema does not say" (every
PARTIAL in the validation run) are the same thing: an owner decision for the rulebook,
not a per-row argument. Rule changes are the owner's call, applied between batches,
never by an agent inside the loop.

## Model tiers (what the tiering hooks point at)

| Tier | For |
|---|---|
| `opus` — default | implementation, review, research, synthesis |
| `sonnet` / built-in Explore | mechanical only, checkable by inspection: inventories, extraction, sweeps |
| `fable` | retired for subagents: Opus 5.5 is the better buy, and the hooks move fable spawns to opus |

Stakes buy **more reviewers from more families**, not a bigger executor. Workflow
scripts must tier every `agent()` call (`model:` or a pinned `agentType`); add
`tier: reviewed` to bypass a false positive.

## Reviewer brief template

Write it to a file and give every reviewer the same file.

```
You are reviewing, not fixing. Read-only: do not create, modify or delete any file.
Unit: <one line>
Change: <diff command or paths>
Spec: <legacy file:line / doc path — the ground truth, not the change's own claims>
Acceptance criteria: <numbered>
Assume the change is wrong. Verify every claim against the spec yourself.
For every test the change cites as proof: name the mutation of the ported behavior
that would make that assertion fail. If none would, that is a finding.
Where the spec or schema does not decide a question, report it as an open question,
not a finding.
Output, one line per finding:
- [critical|major|minor] <where>: <what is wrong> — evidence: <path:line you opened> — fix: <value>
No finding without a path:line you actually opened. "No findings" is a valid answer.
```

## Cost log

One line per unit or batch in the project's cost log (wall clock, tokens, agents,
models). Budgets are multiplications — units x (1 implementer + N reviewers + fixer)
x per-agent estimate — not feelings.
