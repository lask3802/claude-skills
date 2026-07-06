---
name: fable-sense
description: Use when a task is high-difficulty, ambiguous, open-ended, or high-stakes — subtle debugging, design with unclear or scattered constraints, requests whose real goal may differ from the literal ask — or when handing such a task to another model or agent (Opus, Codex), or when the current session context has grown long and cluttered. Not for mechanical tasks with a clear spec.
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

### 4. High stakes → cross-model tail guard

Ceiling performance ≠ zero tail risk. When failure is hard to reverse, hides,
or gets built upon, have the *other* model family try to refute the finished
artifact (uncorrelated blind spots):

```bash
# Claude session -> Codex reviews (write prompt to a file, pipe via stdin):
codex exec --sandbox read-only --skip-git-repo-check --color never \
  --cd "<workspace>" --output-last-message "<out.md>" - < review-prompt.md
# Codex session -> Claude reviews:
claude -p "Adversarially review <artifact>: try to refute its key claims. Findings as file:line, severity-ranked."
```

Review prompt must say: *try to refute; report what's missing, not only
what's wrong; anchor findings to file:line.*

Give the cross-model call a generous timeout (≥10 minutes) — observed in
testing: a default 120 s exec timeout kills `claude -p` before it answers.
If it still can't complete, say so in the deliverable rather than skipping
silently (as validated: the Codex run disclosed its timed-out attempt).

## Quick reference

| Situation | Move |
|---|---|
| Hard ask arrives mid-long-session | Brief → fresh subagent / new `codex exec` |
| Ask carries someone's diagnosis | Strip it from the dispatch; list it under EVIDENCE FIRST as unverified |
| "Just do X quickly" but X looks wrong | Investigate first (it's usually cheaper than the workaround); if you deviate, lead your answer with the deviation and why |
| Result will be built upon / hard to undo | Cross-model refutation pass before accepting |
| Mechanical task, clear spec | Skip this skill entirely — just do it |

## Common mistakes

- Running the protocol on trivial tasks (ceremony tax; the skip row above is
  part of the skill).
- Dispatching "fix the timezone bug" when the timezone is the *theory* —
  you've just shipped the anchor.
- Treating a subagent's confident prose as verification. Ask what was *run*.
- Re-validating: models change. Re-run `eval/` (RUBRICS.md is pre-registered)
  against a new executor before trusting it with this playbook.
