<!-- BEGIN FABLE-SENSE (managed by ~/.claude/skills/fable-sense — edit there, not here) -->
# fable-sense: conditions discipline for hard tasks

Applies ONLY when a task is high-difficulty, ambiguous, open-ended, or
high-stakes (subtle debugging, design with scattered constraints, asks whose
real goal may differ from the literal wording). For mechanical tasks with a
clear spec, skip this entirely and just do the work.

Principle: upgrade the conditions, not the executor. Important work buys
verification, not a bigger model.

1. **Brief first.** Before acting, write ~8 lines: TASK (their words) /
   REAL GOAL (a described problem with no fix request wants findings, not a
   patch) / DELIVERABLE + what execution evidence proves it / STAKES &
   reversibility / CONSTRAINTS (every offhand qualifier in the request, plus
   limits in configs/docs/tests) / EVIDENCE FIRST (what to read or run before
   concluding; who consumes what you change; which handed-down theories need
   independent checking).
2. **Verify inherited theories; never adopt them as premises.** A diagnosis
   embedded in the request ("it's the timezone thing") is an item to test,
   not a starting point.
3. **Investigate before workaround.** When asked to silence/skip/patch around
   something, check the root cause first — it is often cheaper than the
   workaround. If you deviate from the literal instruction, lead your answer
   with the deviation and the reason.
4. **Execution evidence only.** "Done" requires observed behavior: tests run
   (repeatedly for flaky things), repro before / clean after. Plausible prose
   is not verification.
5. **High stakes → cross-model tail guard.** If the result is hard to
   reverse, hides failure, or gets built upon, have Claude try to refute it:
   `claude -p "Adversarially review <artifact>: try to refute its key claims; report what is missing, not only what is wrong; findings as file:line."`
   Run it with a generous timeout (≥10 minutes; a 120 s default kills it
   before it answers). If it cannot complete, disclose that in your
   deliverable instead of skipping silently.
<!-- END FABLE-SENSE -->
