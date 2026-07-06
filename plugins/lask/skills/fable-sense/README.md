# fable-sense

Get Fable-level results on hard/heuristic/judgment-heavy tasks from Opus and
Codex by engineering the conditions that were empirically shown to produce
them — instead of lecturing the models on how to think.

Built, tested (RED/GREEN/REFACTOR per superpowers:writing-skills), and
iterated by Claude Fable 5 on 2026-07-06 at the user's request, ahead of
Fable's removal from subscription access.

## What ships where

| Piece | Path | Consumer |
|---|---|---|
| Skill (protocol, Claude adapter) | this directory's `SKILL.md` | Claude Code (any model) — `/lask:fable-sense` when installed via the lask plugin, `/fable-sense` as a bare `~/.claude/skills/` copy |
| Codex adapter (manual install) | copy `codex-agents-block.md` into `~/.codex/AGENTS.md` (marked block) | every `codex` session |
| Optional trigger line (manual install) | a marked `FABLE-SENSE` block in `~/.claude/CLAUDE.md` telling sessions to invoke the skill for hard tasks | every Claude session |
| Eval harness + evidence | `eval/` (templates, pre-registered RUBRICS.md, all run answers, grades) | re-validation |
| Design doc + results | `docs/design.md` | humans |

The Claude side works as soon as the plugin is installed. The Codex side and
the CLAUDE.md trigger are per-machine one-time copies — the plugin cannot
write outside its own directory.

## The empirical basis (read before trusting)

12/12 baseline runs (Opus 4.8 ×10, Codex gpt-5.5 ×2) — later extended to
19 runs total including GREEN non-degradation, a no-ceremony probe, and two
Codex production-config runs, all at the bar — scored 5/5 on pre-registered
rubrics across five trap variants: hidden-policy "bug" (T1), buried-constraint
design (T2), planted-red-herring debugging (T3), + deadline/social-proof
pressure (T3P), + multi-ask clutter with an explicit wrong instruction (T3D).
Zero judgment failures — INCLUDING resisting the requester's wrong preference
and disclosed deviations from bad literal instructions.

So the leverage is not "make the model smarter"; it is:
1. fresh context, 2. a written brief, 3. investigation framing (never ship
the anchor), 4. execution evidence, 5. cross-model refutation for tail risk.

Limitations, honestly: n=2 per cell; single-session mini-repos; grader =
task author (mitigated by pre-registered binary rubrics + all artifacts kept
in `eval/`). Long-horizon / giant-repo gaps were NOT tested.

## Re-validation (when models change)

1. Copy a template from `eval/templates/` to a scratch dir per run.
2. Send the matching `eval/PROMPT-*.txt` to the target executor (subagent or
   `codex exec --sandbox workspace-write --cd <dir>`), appending: "write your
   final response to ANSWER.md".
3. Grade against `eval/RUBRICS.md` (frozen; changes go in its CHANGELOG).
4. Compare with `eval/results/grades.md`.

## Uninstall

Remove the marked blocks from `~/.claude/CLAUDE.md` and `~/.codex/AGENTS.md`;
the skill itself goes away with the plugin (or by deleting a bare
`~/.claude/skills/fable-sense` copy if you installed one).

## Relationship to director mode

The director's dispatch rubric and this skill agree and compose: the brief
carries the intelligence; verification, not a bigger executor, buys safety
for important work. fable-sense supplies the brief template and the
conditions checklist a director (or any solo session) uses when a hard task
shows up; the roster agents are one way to get the "fresh executor" this
skill calls for.
