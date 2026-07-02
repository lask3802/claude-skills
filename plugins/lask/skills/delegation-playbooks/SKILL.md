---
name: delegation-playbooks
description: Use when starting a feature, bugfix, research question, refactor, or code review — the standard dispatch loop, ready-made dispatch prompts, and escalation points for each scenario. Compose and adapt; don't cargo-cult.
---

# Delegation Playbooks

Standard loops for the five common scenarios. Roster: see skill `lask:director` for calibration; every dispatch uses the four-piece set (goal, scope, constraints, acceptance criteria). Scenarios compose — a feature often contains a research leg and ends in a review leg.

## Feature

```
lask:scout (current state) ∥ lask:researcher (external, only if needed)
  → director writes the spec (four-piece set)
  → lask:second-opinion on the spec — director adjudicates each finding
  → lask:implementer (build + self-test)
  → lask:verifier (acceptance criteria)
  → director final review (personally only if HIGH stakes)
```

Escalation: HIGH stakes (hard rollback, hidden failures, upstream of later work) → director reviews the diff personally on top of the verifier pass.

Dispatch seed — scout: `Goal: map everything <feature> will touch. Scope: <repo/dirs>. Report entry points, conventions to follow, and landmines, path:line anchored.`

## Bugfix

```
lask:debugger (reproduce → root cause, fixes NOT authorized)
  → director picks the fix option
  → lask:implementer (fix + regression test)
  → lask:verifier (fix criteria + regression suite)
```

Escalation: cannot reproduce → widen to `lask:scout` for environment/state diffs before burning debugger rounds. Data-loss or security implicated → HIGH stakes, director reviews personally.

Dispatch seed — debugger: `Goal: root-cause <symptom>. Scope: <area>. Constraints: diagnostics only, revert probes, do NOT fix. Acceptance: proven causal chain, path:line anchored, plus fix options.`

## Research

```
lask:researcher (external) ∥ lask:scout (internal fit) — parallel, one message
  → director synthesizes and decides
```

Escalation: decision is architectural or hard to reverse → add `lask:second-opinion` on the written recommendation before committing to it.

## Refactor

```
lask:scout (blast radius: callers, tests, hidden couplings)
  → director sets strategy and batch boundaries
  → lask:implementer per batch (behavior-preserving, self-test per batch)
  → lask:verifier (prove behavior unchanged: same tests green before/after)
```

Escalation: no meaningful test coverage on the target → stop; first dispatch is `lask:implementer` writing characterization tests, or the refactor cannot be verified at all.

## Review

```
lask:reviewer (first pass, severity-ranked) ∥ lask:second-opinion (cross-model, independent)
  → director merges: reads critical/major from both, spot-checks minors, adjudicates disagreements
  → verdict with per-finding adopt/reject reasons
```

Run the two reviewers in parallel and independently — do not show either the other's findings before they report; convergence is signal, divergence is where the blind spots are.
