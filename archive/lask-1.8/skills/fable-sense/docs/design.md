# fable-sense — Design Document

Date: 2026-07-06
Author: Claude Fable 5 (designed, tested, and iterated in-session per user request)
Status: v1

## Problem

Fable 5 is leaving subscription access. The user wants Opus (Claude Code) and
Codex (GPT-5.x CLI) to approximate Fable-level performance on:

1. 高難度 tasks — hard, multi-constraint reasoning
2. 啟發性 tasks — open-ended/heuristic work with no clear spec
3. 任務 sense — construing what a request actually needs (deliverable type,
   altitude, action calibration)

## Core insight

The gap between a Fable-tier and Opus-tier model on such tasks is not raw
inability — it is a small set of recurring, recognizable failure modes:

| # | Failure mode | Typical symptom |
|---|---|---|
| F1 | Literal construal | Answers the stated question, misses the real ask |
| F2 | First-plausible anchoring | Commits to first interpretation/hypothesis, confirmation-biases through |
| F3 | Shallow recon | Changes behavior without finding who depends on it |
| F4 | Miscalibration | Presents plausibility as fact; skips verification |
| F5 | Altitude error | Overengineers simple things / underengineers hard ones |
| F6 | Action miscalibration | Patches when an assessment was wanted; adopts the requester's framing uncritically |

Scaffolding closes these gaps ONLY when each protocol step forces a written
artifact that constrains the next step. Generic exhortations ("think
carefully", "be thorough") change nothing.

## Architecture decision

Considered:

- **A. Pure skill package** — protocol as a skill; Codex gets the same
  protocol via `~/.codex/AGENTS.md`. Fast iteration (no restart), portable
  across both harnesses, foldable into the lask plugin later.
- **B. Plugin + hooks (forced injection)** — deterministic, but classifying
  "is this task hard?" in a hook is itself the judgment problem; taxes every
  prompt; restart per iteration; cannot help Codex at all; interacts with the
  user's already-heavy hook stack.
- **C. Cross-model ensemble harness** — biggest capability lift (uncorrelated
  error families), but 2–4× cost/latency if applied to everything.

**Chosen: A as the core, with C embedded as a stakes-gated escalation tier
inside the protocol.** B deferred until the content is validated — enforcing
unvalidated content just enforces noise.

Trigger reliability (the known weakness of A) is mitigated two ways:
1. Skill description tuned to fire on symptoms of hard/ambiguous tasks.
2. One marked line in the user's global CLAUDE.md instructing any session to
   engage the protocol for non-mechanical tasks.

## Components

```
~/.claude/skills/fable-sense/
  SKILL.md            # Claude adapter: frontmatter + full protocol (Opus consumes this)
  codex-agents-block.md  # the marked block installed into ~/.codex/AGENTS.md
  docs/design.md      # this document
  eval/               # frozen eval harness for future re-validation
README-level rationale lives in SKILL.md header + this doc.
~/.codex/AGENTS.md    # gets the marked FABLE-SENSE block (Codex consumes this)
~/.claude/CLAUDE.md   # gets one marked trigger line
```

## Validation methodology (TDD for skills — superpowers:writing-skills)

RED → GREEN → REFACTOR:

1. **RED**: 3 trap tasks, each keyed to specific failure modes, with
   pre-registered binary rubrics (eval/RUBRICS.md) written before any run.
   Opus baseline (no skill), n=2 per task. Document verbatim failures.
2. **GREEN**: write the protocol targeting the observed failures only.
   Opus treatment (skill text in context), n=2 per task, same rubrics.
3. **REFACTOR**: where treatment still fails, sharpen that clause; re-run.
4. **Codex arm**: baseline vs +protocol via `codex exec` on ≥1 task.

Trap tasks:
- **T1** (F1/F3/F6): docstring/code mismatch where the "obvious fix" violates
  a policy encoded in a doc + test; requester pushes the wrong preference;
  real deliverable is an assessment.
- **T2** (F2/F5): "implement dedupe, production-ready" with load-bearing
  constraints (128MB, streaming generators, 10-min redelivery window,
  conflicting-payload duplicates) scattered in README/config/sample data.
- **T3** (F2/F4): intermittent test failure with a planted wrong theory
  (timezone) endorsed by a comment + teammate; real cause is set-iteration
  order under hash randomization.

### Known limitations (stated honestly)

- n=2 per cell: enough to see gross failure-mode shifts, not fine effects.
- Grader (Fable) also authored tasks and protocol → overfit risk. Mitigated
  by pre-registered binary criteria and by grading strictly from artifacts.
- Tasks are Python-centric minis; generalization to big repos is assumed via
  the failure-mode framing, not proven.
- The protocol's trigger step (does the model engage it?) is only partially
  testable in subagent injection; real-session triggering depends on the
  description + CLAUDE.md line.

## Results (2026-07-06)

**RED: 12/12 runs at 5/5 — zero failures, both models.** Opus 4.8 (10 runs:
T1/T2/T3 ×2, T3P pressure ×2, T3D clutter+bad-instruction ×2) and Codex
(2 runs: T2, T3P) all hit every pre-registered criterion; several runs
exceeded the rubric (counterfactual payout analysis, honest capacity math,
deviation-led answers).

Consequence (Iron Law of writing-skills): a "reasoning protocol" could not
be authored — the failures it would target do not exist under these
conditions. The skill was reframed as a **conditions-engineering technique**:
brief → fresh dispatch → investigation framing → execution evidence →
cross-model tail guard. Its premise (those conditions ⇒ ceiling judgment) is
exactly what RED validated.

**GREEN: 4/4 PASS.** T2-treat and T3D-treat: no degradation with the skill
loaded (T2-treat was the most calibrated run of all). T5 trivial probe: no
ceremony (1-line fix, 5-line answer). Codex + AGENTS.md block: no
degradation, plus two intended behavioral deltas (live config binding;
attempted the claude -p tail guard and disclosed its timeout honestly).

**REFACTOR:** one friction found and fixed — cross-model `claude -p` call
needs ≥10 min timeout (a 120 s default killed it); guidance added to both
adapters.

## Future work

- Fold into lask plugin (`skills/fable-sense/`) for distribution.
- Optional hook enforcement (option B) once content is stable.
- Re-run eval/ (frozen, pre-registered) whenever executor models change.
- The untested frontier remains: very-long-horizon work, giant-repo
  navigation, week-scale architectural taste. If a reproducible failure is
  ever observed there, THAT is the failing test to write new guidance
  against.
