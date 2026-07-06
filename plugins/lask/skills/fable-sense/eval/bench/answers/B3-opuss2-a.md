# Recommendation: put July's $60k on Channel A — not B

Marketing's recommendation is backwards. Their numbers are real, but both
conversion counts are corrupted by tracking defects your own ops log records,
and the two defects push in opposite directions. Correct for them and the
ranking flips.

Full write-up with the daily table is in `ANALYSIS.md`; the script that computes
and reconciles every figure is `analyze.py` (run `python analyze.py`).

## What actually happened in June

Both channels ran a dead-flat daily conversion rate, which makes the two glitches
obvious:

- **Channel A lost 7 days of data.** The 6/10 checkout migration broke A's
  tracking pixel; conversions from 6/10–6/16 were never recorded (and never
  backfilled), while A kept spending $1,000/day the whole time. That silently
  erased ~350 real A conversions. **A is understated.**
- **Channel B was double-counted for 8 days.** The 6/28 vendor re-import for the
  6/20–6/27 outage duplicated events that were already ingested — B shows exactly
  2× its normal rate for exactly those 8 days, then snaps back to normal on 6/28.
  That added ~360 phantom B conversions. **B is overstated.**

These two artifacts account for essentially the *entire* gap marketing saw, and
the arithmetic reconciles to the unit:

| | Marketing's number | Corrected | |
|---|---|---|---|
| **Channel A** | 1,150 conv → CPA $26.09 | **1,500 conv → CPA $20.00** | +350 lost pixel days restored |
| **Channel B** | 1,710 conv → CPA $17.54 | **1,350 conv → CPA $22.22** | −360 duplicate backfill removed |

Corrected, **A converts at ~$20.00 vs B at ~$22.22 — A is about 11% more
efficient**, and beats B on every clean day of the month. Marketing's "B won by
33%" is an artifact of comparing A's broken data against B's inflated data.

## Before you commit the money

- **A's under-count is certain** (the ops log states the pixel was down). **B's
  over-count is a very strong inference** from the exact-2×/snap-back pattern —
  worth a one-line confirmation from the vendor that the 6/28 re-import didn't
  dedupe. It doesn't change the pick: under every defensible reading, A wins or
  ties.
- **Going all-in doubles A to $2,000/day, which June never tested.** The data
  says A is the better channel at $30k, not that it holds $20 CPA at $60k —
  watch for diminishing returns. If "all-in" has any flex, ramp A while keeping a
  small check on B. Under a hard all-in rule, A is still the right single bet.
- **Fix the pipeline before trusting July:** add pixel-down alerting and make
  vendor re-imports idempotent (dedup on event_id). Two failure modes in one
  month means the raw dashboard can't be taken at face value yet.

**Bottom line: all-in on A.** And it's worth walking marketing through the daily
data — their conclusion was reasonable given the dashboard, but the dashboard was
wrong in both directions.
