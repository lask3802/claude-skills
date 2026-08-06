<!-- BEGIN FABLE-SENSE (managed by the lask plugin — plugins/lask/skills/fable-sense; edit there, not here) -->
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
   is not verification. Three additions, each traced to a measured miss:
   (a) analysis/decision deliverables must include the runnable computation
   (script or exact commands), not just the numbers; (b) a fix for an
   order/state/timing-dependent bug counts as verified only under permuted
   conditions (reversed order, other seeds) — the reported scenario going
   green is not enough; (c) before finishing, name adjacent hazards you
   observed but did not fix (e.g., a retry wrapper around a non-idempotent
   call), with options.
5. **High stakes → adversarial tail guard.** If the result is hard to
   reverse, hides failure, or gets built upon, spawn a fresh `codex exec`
   session to try to refute it — fresh context is what the guard buys. Do
   NOT shell out to `claude -p`; measured in production it fails or times
   out on nearly every run inside Codex sessions. Write the review prompt
   to a file and pipe it via stdin (never as a shell arg — codex hangs on
   an open stdin). Stream progress while preserving the final artifact.
   Bash (not plain `/bin/sh`):
   `set -o pipefail; for f in review-attempt1-events.jsonl review-attempt1-stderr.log "<out-attempt1.md>"; do if [ -e "$f" ] || [ -L "$f" ]; then echo "refusing to overwrite $f" >&2; exit 73; fi; done; codex exec --sandbox read-only --skip-git-repo-check --color never --cd "<workspace>" --json --output-last-message "<out-attempt1.md>" - < review-prompt.md 2> review-attempt1-stderr.log | tee review-attempt1-events.jsonl && test -s "<out-attempt1.md>"`
   PowerShell 7+ (not Windows PowerShell 5.1):
   `$ErrorActionPreference='Stop'; $PSNativeCommandUseErrorActionPreference=$false; $OutputEncoding=[Text.UTF8Encoding]::new($false); [Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); $artifacts=@('review-attempt1-events.jsonl','review-attempt1-stderr.log','<out-attempt1.md>'); foreach($artifact in $artifacts){if(Test-Path -LiteralPath $artifact){throw "refusing to overwrite $artifact"}}; Get-Content -Raw -Encoding utf8 review-prompt.md | & codex exec --sandbox read-only --skip-git-repo-check --color never --cd "<workspace>" --json --output-last-message "<out-attempt1.md>" - 2> review-attempt1-stderr.log | Tee-Object -FilePath review-attempt1-events.jsonl; $codexExit=$LASTEXITCODE; if ($null -eq $codexExit) { exit 127 }; if ($codexExit -ne 0) { exit $codexExit }; if(-not (Test-Path -LiteralPath '<out-attempt1.md>' -PathType Leaf) -or (Get-Item -LiteralPath '<out-attempt1.md>').Length -eq 0){exit 66}; Get-Content -Encoding utf8 review-attempt1-events.jsonl | ForEach-Object { $_ | ConvertFrom-Json -ErrorAction Stop | Out-Null }`
   The prompt must say: try to refute; report what is missing, not only
   what is wrong; findings as file:line — and carry only the artifact,
   never your own conclusions about it. Keep stderr separate so the JSONL
   file remains parseable. Both recipes refuse existing attempt artifacts and
   require a fresh non-empty final message. Allow a generous timeout (≥10 minutes); events
   show activity, but only a zero exit plus the output file prove completion.
   On parent timeout, check the child process and artifacts before retrying;
   the child may still finish. Use fresh `attempt2` output names for a confirmed
   retry so prior evidence is not overwritten. If the pass cannot run or complete, skip it
   and disclose that in your deliverable instead of blocking on it.
<!-- END FABLE-SENSE -->
