---
name: fable-sense
description: Use when a task is high-difficulty, ambiguous, open-ended, or high-stakes — subtle debugging, design with unclear or scattered constraints, requests whose real goal may differ from the literal ask — or when handing such a task to another model or agent (Opus, Codex), or when the current session context has grown long and cluttered. Not for mechanical tasks with a clear spec, and not for sessions already running on Fable — the discipline is native there; from Fable, use it only when dispatching to another executor.
---

# fable-sense — Fable-level results from Opus & Codex

## Overview

Empirical core (see `eval/` in this skill dir): given **fresh context, a
well-formed brief, investigation framing, and room to execute/verify**,
Opus 4.8 and Codex both scored 11/11 perfect on Fable-level judgment traps —
hidden-policy fixes, buried constraints, planted red herrings — including
under deadline pressure and multi-ask clutter. What degrades frontier-level
judgment in practice is *conditions*, not model capability. This skill
engineers those conditions, and buys independent verification where a rare
miss would be expensive.

**Principle: upgrade the conditions, not the executor. Important work buys
verification, not a bigger model.**

**Fable exemption.** This protocol recreates, for Opus and Codex, the sense
Fable applies natively. The 5-arm benchmark (see `eval/bench`) ran Fable bare
as the reference arm, and it topped every assisted arm (pooled 9.67 vs 8.83
for opus+sense). So a session already running on Fable should not run the
protocol on itself — it uses this skill only for the brief/dispatch machinery
when handing hard work down to another executor (Opus, Codex).

## The technique

### 1. Write the brief (before any action)

~10 lines, written out, not mental:

```
TASK: <the ask, one sentence, user's words>
REAL GOAL: <outcome they need. A described problem with no fix request
  is asking for findings, not a patch>
DELIVERABLE: <code change / diagnosis / options / doc> + <what execution
  evidence will prove it (tests run, repro observed)>
STAKES: <what breaks if wrong; how reversible>
CONSTRAINTS: <every offhand qualifier in the request ("in prod", "128MB",
  "sometimes", "by Friday") + limits found in configs/docs/tests>
EVIDENCE FIRST: <what to read/run before concluding; who consumes what
  you're changing; which handed-down theories need independent checking>
```

### 2. Execute under good conditions

- **Fresh context beats long context.** Session deep or cluttered? Dispatch
  the brief to a fresh executor — Claude: subagent (Opus is the validated
  default); Codex: a new `codex exec`. Include the brief verbatim.
- **Frame as investigation, not conclusion.** "Figure out what's going on
  with X" outperforms "fix X by doing Y". Never embed a suspected answer or
  inherited theory in the dispatch — anchoring is how red herrings propagate.
  Pass theories as items to *verify*, labeled as unconfirmed.
- **One hard task per dispatch**, with the repo and the run/test commands.

### 3. Demand execution evidence

Accept "done" only with observed behavior: tests run N times, repro before /
clean after, ranked output recomputed from data. Plausible prose ≠ evidence.

Three misses that survive even good runs (each measured in the 2026-07
benchmark; see eval/bench):
- **Analysis must ship its computation.** For data/decision deliverables,
  commit the script or exact commands next to the conclusions — numbers
  without runnable provenance failed 9/9 benchmark runs, including the
  reference model.
- **Order/state bugs need permuted verification.** A fix for an
  order/state/timing-dependent failure is verified only under permuted
  conditions (reversed order, other seeds, alternative sequences). A green
  run of the originally-reported scenario alone repeatedly passed fixes that
  still carried the bug class.
- **Name adjacent hazards before finishing.** If you observed a nearby
  landmine you didn't fix (e.g., a retry wrapper around a non-idempotent
  call), say so with options — staying silent ships it. Only 2/9 benchmark
  runs did this unprompted.

### 4. High stakes → cross-model tail guard

Ceiling performance ≠ zero tail risk. When failure is hard to reverse, hides,
or gets built upon, have the *other* model family try to refute the finished
artifact (uncorrelated blind spots):

```bash
# Claude session -> Codex reviews (write prompt to a file, pipe via stdin):
codex exec --sandbox read-only --skip-git-repo-check --color never \
  --cd "<workspace>" --output-last-message "<out.md>" - < review-prompt.md
# Codex session -> Claude reviews — ALWAYS stream the output; a bare
# `claude -p` prints nothing until it finishes and reads as hung:
claude -p "Adversarially review <artifact>: try to refute its key claims. Findings as file:line, severity-ranked." \
  --output-format stream-json --verbose
```

Review prompt must say: *try to refute; report what's missing, not only
what's wrong; anchor findings to file:line.*

Streaming fixes the silence, not the duration: still give the cross-model
call a generous timeout (≥10 minutes) — a default 120 s exec timeout kills
`claude -p` before it answers. With `--output-format stream-json --verbose`
the CLI emits JSONL events continuously (without `--verbose` it errors); the
final `"type":"result"` line carries the complete review. If the call still
can't complete or the `claude` CLI is unavailable, say so in the deliverable
rather than skipping silently (as validated: the Codex run disclosed its
timed-out attempt).

## Quick reference

| Situation | Move |
|---|---|
| Hard ask arrives mid-long-session | Brief → fresh subagent / new `codex exec` |
| Ask carries someone's diagnosis | Strip it from the dispatch; list it under EVIDENCE FIRST as unverified |
| "Just do X quickly" but X looks wrong | Investigate first (it's usually cheaper than the workaround); if you deviate, lead your answer with the deviation and why |
| Result will be built upon / hard to undo | Cross-model refutation pass before accepting |
| Session already running on Fable | Skip the protocol — it's native; use only the brief/dispatch discipline when handing work to Opus/Codex |
| Mechanical task, clear spec | Skip this skill entirely — just do it |

## Common mistakes

- Running the protocol on trivial tasks (ceremony tax; the skip row above is
  part of the skill).
- Running the protocol on a Fable session is the same ceremony tax — the
  exemption is part of the skill.
- Dispatching "fix the timezone bug" when the timezone is the *theory* —
  you've just shipped the anchor.
- Treating a subagent's confident prose as verification. Ask what was *run*.
- Re-validating: models change. Re-run `eval/` (RUBRICS.md is pre-registered)
  against a new executor before trusting it with this playbook.
