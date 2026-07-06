# Benchmark grades (criteria per RUBRICS-BENCH.md, frozen)

Score = criteria met /10. Grading strictly from artifacts + grader re-execution.

## B1 — caching under scattered constraints

| Run | 1 rates | 2 prof | 3 token | 4 nopost | 5 thread | 6 bound | 7 key | 8 retry | 9 test | 10 trade | Total |
|---|---|---|---|---|---|---|---|---|---|---|---|
| fable | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 10/10 |
| opus-a | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 0 | 1 | 1 | 9/10 |
| opus-b | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 0 | 1 | 1 | 9/10 |
| opuss-a | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 10/10 |
| opuss-b | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 0 | 1 | 1 | 9/10 |
| codex-a | 1 | 1 | 1 | 1 | 0 | 1 | 1 | 0 | 1 | 1 | 8/10 |
| codex-b | 0 | 0 | 1 | 1 | 1 | 0 | 1 | 0 | 1 | 1 | 6/10 |
| codexs-a | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 0 | 1 | 1 | 9/10 |
| codexs-b | 1 | 0 | 1 | 1 | 1 | 1 | 1 | 0 | 1 | 1 | 8/10 |

## B2 — order-dependent test failure

| Run | 1 repro | 2 pair | 3 root | 4 refute | 5 civslocal | 6 fix | 7 noesc | 8 audit | 9 verif | 10 write | Total |
|---|---|---|---|---|---|---|---|---|---|---|---|
| fable | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 10/10 |
| opus-a | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 0 | 1 | 1 | 9/10 |
| opus-b | 1 | 0 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 9/10 |
| opuss-a | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 0 | 1 | 1 | 9/10 |
| opuss-b | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 0 | 1 | 1 | 9/10 |
| codex-a | 1 | 0 | 1 | 1 | 1 | 0 | 1 | 0 | 1 | 1 | 7/10 |
| codex-b | 1 | 0 | 1 | 1 | 1 | 0 | 1 | 0 | 1 | 1 | 7/10 |
| codexs-a | 1 | 1 | 1 | 1 | 1 | 0 | 1 | 0 | 1 | 1 | 8/10 |
| codexs-b | 1 | 0 | 1 | 1 | 1 | 0 | 1 | 0 | 1 | 1 | 7/10 |

## B3 — budget decision on dirty data

| Run | 1 dups | 2 reimp | 3 outage | 4 math | 5 flip | 6 refute | 7 repro | 8 sens | 9 calib | 10 scope | Total |
|---|---|---|---|---|---|---|---|---|---|---|---|
| fable | 1 | 1 | 1 | 1 | 1 | 1 | 0 | 1 | 1 | 1 | 9/10 |
| opus-a | 0 | 1 | 1 | 1 | 1 | 1 | 0 | 1 | 1 | 1 | 8/10 |
| opus-b | 1 | 1 | 1 | 1 | 1 | 1 | 0 | 1 | 1 | 1 | 9/10 |
| opuss-a | 0 | 1 | 1 | 1 | 1 | 1 | 0 | 1 | 1 | 1 | 8/10 |
| opuss-b | 0 | 1 | 1 | 1 | 1 | 1 | 0 | 1 | 1 | 1 | 8/10 |
| codex-a | 0 | 1 | 1 | 1 | 1 | 1 | 0 | 1 | 1 | 1 | 8/10 |
| codex-b | 1 | 1 | 1 | 1 | 1 | 1 | 0 | 1 | 1 | 1 | 9/10 |
| codexs-a | 0 | 1 | 1 | 1 | 1 | 1 | 0 | 1 | 1 | 1 | 8/10 |
| codexs-b | 1 | 1 | 1 | 1 | 1 | 1 | 0 | 1 | 1 | 1 | 9/10 |

## Notes per run

- B2-fable: 3 explicit refutation experiments (incl. reverse-order run and
  CI-env simulation), reset()+autouse conftest, named test_zz_reporting as
  same-pattern polluter, 3 verification modes. Textbook.
- B2-opus-a 9/10: pair experiments both directions, RETRY_BUDGET refuted;
  missed zz_reporting audit (C8).
- B2-opus-b 9/10: explicit zz flag + reversed-order proof; polluter identity
  by code-reading only, no pre-fix pair isolation run (C2).
- B2-opuss-a 9/10: pair table both directions, byte-identical refutation;
  no zz_reporting mention (C8).
- B3-fable 9/10: every trap found (360 dups linked to 6/28 re-import,
  outage cross-checked in data, two-method consistency = sensitivity,
  10% margin + saturation caveat). Repro section is a method description,
  no runnable script/commands shown (C7=0, strict).
- Grading bar C7(B3): requires visible script/commands or committed analysis
  code, applied uniformly. Bar C8(B2): requires explicit statement that
  test_zz_reporting also mutates config.
- Grading bar C1(B3): requires event_id-level duplicate detection, not just
  the 90/day pattern. Bar C5(B1): thread-safety must be tied to worker.py
  evidence or explicit reasoning, not asserted.
- B1-fable 10/10: only run to surface the 503-retry-duplicates-orders hazard;
  also pinned profile TTL under the compliance bound WITH a test.
- B1-codex-b 6/10: right TTL values but no stated justification; per-user
  profile cache UNBOUNDED (leaks on long-lived worker); no retry-hazard.
- B2-codex-a/b 7/10: both replaced the settings cache with live env reads +
  a module-level _overrides dict - GRADER EXECUTED reversed order
  (zz_reporting first): still FAILS. The pollution class survives; fix is
  green-suite-only. Claude arms all shipped autouse-reset isolation instead.
- B3: only opus-b and codex-b did event_id-level duplicate verification;
  everyone else argued from the 2x-pattern. opuss-a even listed id-dedup as
  an action item for the vendor instead of running it on the data at hand.
- B1-opuss-a 10/10: opened with the skill's EVIDENCE FIRST move ("read docs +
  worker.py before touching anything"); the ONLY non-fable run to surface the
  503-retry duplicate-order hazard (with two remediation options, left to the
  user); compliance bound enforced in the constructor (ValueError), not in a
  comment; single-flight concurrency test (8 threads -> 1 request).
- B1-opus-a 9/10: excellent engineering (striped locks, worker simulation,
  23 tests) but the 503/create_order hazard went unmentioned (C8).

## FINAL QUANTIFICATION (all 27 runs)

| Task | fable | opus | opus+sense | codex | codex+sense |
|---|---|---|---|---|---|
| B1 caching | 10 | 9.0 (9,9) | **9.5** (10,9) | 7.0 (8,6) | **8.5** (9,8) |
| B2 test pollution | 10 | 9.0 (9,9) | 9.0 (9,9) | 7.0 (7,7) | **7.5** (8,7) |
| B3 dirty-data decision | 9 | 8.5 (8,9) | 8.0 (8,8) | 8.5 (8,9) | 8.5 (8,9) |
| **Pooled mean** | **9.67** | **8.83** | **8.83** | **7.50** | **8.17** |

Deltas (sense - base):
- Opus: B1 +0.5, B2 0.0, B3 -0.5 -> pooled **0.00**
- Codex: B1 +1.5, B2 +0.5, B3 0.0 -> pooled **+0.67** (non-negative on all
  three tasks; largest where baseline was weakest)

Mechanism of the Codex lift (inspectable per-criterion):
- B1: doc-cited TTL justifications (C1/C2), bounded caches (C6) appeared in
  codexs but not codex-b.
- B2: pre-fix repro + minimal-pair isolation experiment appeared (codexs-a).
These are exactly the protocol's EVIDENCE FIRST / constraints-scan moves.

Persistent blind spots the current skill did NOT fix (= new failing tests
for the next REFACTOR, per the Iron Law):
1. B3-C7: 0/9 runs (including fable) delivered runnable analysis artifacts.
2. B2-C6: all 4 codex runs shipped order-fragile fixes; none verified under
   permuted test order (fable/opus-b did).
3. B1-C8: only fable and opuss-a surfaced the adjacent 503-retry hazard.

Caveats: n=2 per cell (n=1 fable), single grader (also task author),
pre-registered binary rubrics, all artifacts retained for audit.

## v1.4.2 REFACTOR confirmation probes (run after the 3 clauses were added)

- B3-opuss2-a (opus + v1.4.2 skill): shipped `analyze.py`, grader-executed
  and reproducing every figure -> the runnable-computation clause fixed the
  0/9 C7 miss on first try. Conclusions unchanged (A, $20.00 vs $22.22).
- B2-codexs2-a (codex + v1.4.2 block): FIRST codex run to add a conftest
  reset; self-ran pair both directions + zz-first + CI-env permutations;
  grader-executed reversed order now PASSES (previous 4/4 codex fixes
  failed it). The permuted-verification clause closed the C6 blind spot.
- Adjacent-hazard clause (B1-C8) not re-probed separately this round; its
  wording mirrors the two confirmed clauses. Re-check at next re-validation.
