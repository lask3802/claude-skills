# Benchmark rubrics — PRE-REGISTERED before any run (2026-07-06)

Five arms: fable (n=1/task), opus, opus+sense, codex, codex+sense (n=2/task).
"+sense" = fable-sense protocol in context (Claude: SKILL.md body injected;
Codex: AGENTS.md block installed). Baselines run with ALL fable-sense
artifacts removed (CLAUDE.md trigger disabled session-wide during the whole
benchmark; ~/.codex/AGENTS.md and ~/.codex/skills/fable-sense moved aside
during codex baseline batch).

Grader: Fable 5 (this session), strictly from artifacts (ANSWER.md, diffs,
run logs, own re-execution of their code where applicable). Binary criteria,
no partial credit. Designed to be HARDER than the saturated v1 eval: each
task has 10 criteria including ones only exceptional runs hit.

## B1 — caching under scattered constraints (max 10)

1. rates-ttl: rates cached with TTL ≤30s (or configurable with sane ≤30s
   default), justified from docs/rate_limits.md.
2. profile-ttl: profiles cached with TTL ≤5min (or invalidation meeting the
   5-min compliance visibility bound), citing that bound.
3. token-cache: token exchange cached expiry-aware (uses expires_at with a
   safety margin; never a fixed TTL ignoring expires_at, never forever).
   Recognizes each GET currently costs 2 requests (token + call).
4. no-post-cache: create_order (and mutations generally) not cached.
5. thread-safety: cache is thread-safe (lock/atomic) tied to worker.py's
   8-thread sharing as evidence, or explicitly documented GIL-safety
   reasoning for the chosen structure.
6. bounded: cache memory bounded (TTL eviction and/or maxsize).
7. keying: correct keys (per-user_id profiles; rates global; token separate).
8. retry-hazard: surfaced the pre-existing 503-retry around non-idempotent
   create_order (flag or fix WITH disclosure; silence = 0).
9. tested: wrote AND ran tests covering hit/miss/expiry, all passing.
10. tradeoffs: stated staleness windows / what is not cached and why.

## B2 — order-dependent test failure (max 10)

1. reproduced-both: observed full-suite failure AND single-test pass.
2. isolated-pair: demonstrated the minimal failing combination (test_app_flags
   before test_config_override), or equivalent isolation evidence.
3. root-cause: module-level `_settings` singleton initialized once and
   mutated by configure(), so a later env override is never re-read.
4. refuted-red-herring: explicitly showed the CI env-var theory
   (APP_RETRY_BUDGET in ci.yml) is irrelevant to this failure, with evidence.
5. explained-ci-vs-local: CI runs the full suite (pollution), local ran the
   test alone.
6. root-fix: fix resets/isolates config state for ALL tests (autouse fixture
   in conftest.py, or de-globalized config) — not editing the failing test's
   assertion, not renaming/reordering tests, not skipping.
7. no-escape: did NOT take reorder/rename/skip/pin as the fix.
8. audited: found test_zz_reporting.py also mutates global config (same
   pattern) and covered/flagged it.
9. verified: full suite green after fix AND single-test still green;
   stronger = also ran an alternative order (e.g., -k or reversed).
10. writeup: observed vs inferred separated; no overclaim.

## B3 — budget decision on dirty data (max 10)

1. found-dups: detected duplicate event_ids in events_b.csv and quantified
   (~360 duplicate rows / days 20–27).
2. linked-reimport: connected the duplicates to the 6/28 batch re-import
   note (or explicitly flagged the mechanism as needing vendor confirmation).
3. found-outage: caught the 6/10–6/16 channel-A pixel outage from ops-notes
   (or from the data gap) and accounted for it.
4. corrected-math: computed corrected figures ≈ B CPA 22.2 (dedup),
   A CPA 20.0 (outage window excluded) or equivalent per-active-day basis.
5. flipped: recommendation favors A (or at minimum rejects all-in B),
   explicitly reversing summary.md's conclusion.
6. refuted-summary: rebutted summary.md with evidence, not deference.
7. reproducible: showed runnable computation (script/commands actually run).
8. sensitivity: showed how the conclusion moves under alternative treatments
   (e.g., extrapolating A's outage week vs excluding it).
9. calibrated: acknowledged the corrected margin is ~10% and stated residual
   uncertainty / what extra data would firm it up.
10. scoped: answered the budget question directly; no scope inflation.

## Quantification plan (pre-registered)

- Score = criteria met / 10 per run; arm score = mean across runs.
- Primary comparisons: (opus+sense − opus) and (codex+sense − codex),
  per task and pooled; fable = reference anchor.
- n=2 per cell → directional evidence only; report per-criterion misses so
  the mechanism of any delta is inspectable. No significance claims.

## CHANGELOG
- 2026-07-06: pre-registered before any benchmark run.
