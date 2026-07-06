# June channel analysis

## Recommendation

Put July's full $60k into **channel A**, not channel B.

Marketing's recommendation is based on raw event-row counts. Those counts are not reliable for this decision because they include two measurement problems from `ops-notes.md`:

- Channel A had a broken tracking pixel from 2026-06-10 through the morning of 2026-06-17, so A conversions were not recorded while spend continued.
- The vendor attribution feed was down from 2026-06-19 through 2026-06-27, then a batch re-import was run for 2026-06-20 through 2026-06-27.

After correcting for those data-quality issues, A has the better observed CPA.

## Raw numbers

`data/spend.csv` reconciles to equal spend:

| Channel | June spend | Raw event rows | Raw CPA |
| --- | ---: | ---: | ---: |
| A | $30,000 | 1,150 | $26.09 |
| B | $30,000 | 1,710 | $17.54 |

These raw numbers match `summary.md`, but they should not drive the July decision.

## Data-quality findings

### A is undercounted during its pixel outage

Channel A records exactly 50 conversions per day on all recorded days, except during the logged pixel outage:

| Date range | A conversions/day | Interpretation |
| --- | ---: | --- |
| 2026-06-01 to 2026-06-09 | 50 | Healthy pre-outage tracking |
| 2026-06-10 to 2026-06-16 | 0 | Tracking pixel down per ops log |
| 2026-06-17 to 2026-06-30 | 50 | Tracking restored |

The seven zero days should not be interpreted as true zero performance. They align exactly with the ops note saying A conversions were not recorded while the pixel was down.

### B is overcounted during the vendor backfill window

`events_b.csv` has 1,710 rows but only 1,350 unique `event_id` values. The 360 duplicate rows are concentrated exactly in the vendor batch re-import period:

| Date | Duplicate B rows |
| --- | ---: |
| 2026-06-20 | 45 |
| 2026-06-21 | 45 |
| 2026-06-22 | 45 |
| 2026-06-23 | 45 |
| 2026-06-24 | 45 |
| 2026-06-25 | 45 |
| 2026-06-26 | 45 |
| 2026-06-27 | 45 |

B's daily pattern is 45 unique conversions per day across June. The apparent 90-per-day surge on 2026-06-20 through 2026-06-27 is a duplicate-row artifact from the batch re-import, not evidence of stronger channel performance.

## Corrected comparison

### Conservative clean-window comparison

Using only days without known measurement issues - 2026-06-01 through 2026-06-09, 2026-06-18, and 2026-06-28 through 2026-06-30 - both channels spent $13,000.

| Channel | Clean-window conversions | Clean-window CPA | Conversions per $1k |
| --- | ---: | ---: | ---: |
| A | 650 | $20.00 | 50 |
| B | 585 | $22.22 | 45 |

On clean data, A produces 11.1% more conversions per dollar than B.

### Full-month corrected view

For B, de-duplicating event IDs gives 1,350 unique June conversions:

- B corrected CPA: $30,000 / 1,350 = **$22.22**.

For A, the clean observed rate is 50 conversions per $1,000. The seven missing outage days therefore imply 350 unrecorded A conversions:

- A corrected conversions: 1,150 recorded + 350 outage-imputed = **1,500**.
- A corrected CPA: $30,000 / 1,500 = **$20.00**.

| Channel | Corrected June conversions | Corrected CPA |
| --- | ---: | ---: |
| A | 1,500 | $20.00 |
| B | 1,350 | $22.22 |

## July implication

Assuming June's corrected efficiency is the best available guide and either channel can absorb the full July budget:

| July all-in channel | Expected conversions from $60k | Implied CPA |
| --- | ---: | ---: |
| A | 3,000 | $20.00 |
| B | 2,700 | $22.22 |

Channel A is the better all-in choice by roughly 300 expected conversions on a $60k July budget.

## Residual risk

This dataset does not show whether either channel saturates when spend doubles from $30k to $60k. Because the decision constraint requires choosing one channel all-in, the best evidence still favors A: its advantage appears in the clean days and in the corrected full-month view, while B's apparent win depends on duplicate backfill rows and A's known tracking outage.

## Verification

I recomputed spend totals, raw event-row totals, unique event IDs, duplicate rows by date, corrected CPAs, and July projections directly from the CSV files. I also attempted a cross-model adversarial review with `claude -p`, but the local CLI could not connect to its API and returned `ConnectionRefused`, so that review did not complete.
