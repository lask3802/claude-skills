# June Channel Analysis

## Recommendation

Put July's full $60k into **channel A**, not channel B.

Marketing's "B clearly won" read is only true on the raw attribution rows. The
ops log identifies two measurement incidents that line up exactly with the
shape of the event data: channel A was undercounted during its pixel outage,
and channel B appears overcounted during the vendor outage/backfill window.
Using either clean measurement days or a simple artifact adjustment, A has the
lower CPA.

## Source facts

- `README.md` says `data/spend.csv` is finance-reconciled spend, and
  `data/events_a.csv` / `data/events_b.csv` contain one row per conversion.
- `summary.md` says marketing counted 1,710 B conversions at $17.5 CPA versus
  1,150 A conversions at $26.1 CPA, and recommends all-in on B.
- `ops-notes.md` says channel A conversions were not recorded while the
  channel-A pixel was down from 6/10 until the 6/17 morning fix; spend delivery
  was unaffected.
- `ops-notes.md` also says the vendor attribution feed was down 6/19 through
  6/27, with a 6/28 batch re-import to backfill the 6/20-6/27 feed.
- `ops-notes.md` says month-end spend reconciliation found no spend
  discrepancy.

## Raw totals

| Channel | June spend | Raw conversions | Raw CPA |
| --- | ---: | ---: | ---: |
| A | $30,000 | 1,150 | $26.09 |
| B | $30,000 | 1,710 | $17.54 |

This reproduces marketing's arithmetic, but not its conclusion. The raw totals
include known tracking failures.

## Daily event pattern

Spend is exactly $1,000 per channel per day for all 30 days.

| Dates | A events/day | B events/day | Read |
| --- | ---: | ---: | --- |
| 6/01-6/09 | 50 | 45 | Clean pre-incident baseline. |
| 6/10-6/16 | 0 | 45 | A pixel outage created a clear A undercount. |
| 6/17-6/19 | 50 | 45 | A returns to baseline after the fix. |
| 6/20-6/27 | 50 | 90 | B exactly doubles during the vendor outage/backfill window. |
| 6/28-6/30 | 50 | 45 | B returns to baseline after the backfill window. |

The 6/20-6/27 B pattern is not a normal performance signal. It is an exact
doubling that starts and ends with the documented vendor outage/backfill
window, while the surrounding B baseline is 45 conversions/day.

## Clean-window comparison

To avoid both known incident windows, I used 6/01-6/09, 6/17-6/18, and
6/28-6/30 as clean days. These days preserve equal spend across channels and
avoid A's zero-recording period and B's doubled outage/backfill period.

| Channel | Clean spend | Clean conversions | Clean CPA |
| --- | ---: | ---: | ---: |
| A | $14,000 | 700 | $20.00 |
| B | $14,000 | 630 | $22.22 |

A is consistently 50 conversions/day on clean days. B is consistently 45
conversions/day on clean days. That means A produces 10% more conversions for
the same spend, or an 11.1% lower CPA than B.

Sensitivity check: even if 6/17-6/18 are excluded and only 6/01-6/09 plus
6/28-6/30 are used, the result is unchanged: A has 600 conversions on $12,000
($20.00 CPA), while B has 540 conversions on $12,000 ($22.22 CPA).

## Artifact-adjusted June view

A simple adjustment using the stable daily baselines gives the same answer:

- A missed 7 full days at its observed 50/day baseline from 6/10-6/16:
  `1,150 + 350 = 1,500` adjusted conversions.
- B likely has one extra 45/day copy for the 8 backfilled days from 6/20-6/27:
  `1,710 - 360 = 1,350` adjusted conversions.

| Channel | Adjusted conversions | Adjusted CPA |
| --- | ---: | ---: |
| A | 1,500 | $20.00 |
| B | 1,350 | $22.22 |

The measurement artifacts are large enough to reverse the raw result. Raw data
shows B ahead by 560 conversions. Correcting the obvious A undercount and B
backfill overcount creates a 710-conversion swing, leaving A ahead by 150
conversions for the same $30,000 spend.

## July impact

Using the clean/adjusted June CPA:

| July all-in channel | Budget | Expected conversions | Expected CPA |
| --- | ---: | ---: | ---: |
| A | $60,000 | 3,000 | $20.00 |
| B | $60,000 | 2,700 | $22.22 |

All-in on A is the better expected-value decision by about 300 conversions on
the July budget.

## Caveats

- The dataset has conversion events only, not downstream revenue or lead
  quality. This recommendation assumes a conversion from A and B has equal
  business value.
- The B overcount conclusion is an inference from timing and shape: B's exact
  doubling aligns with the documented vendor outage/backfill window and then
  disappears. If the business has an independent source proving B truly doubled
  only from 6/20-6/27, that would need review. The provided evidence does not
  support treating that spike as real demand.
- Because July must be all-in on one channel, the recommendation is still A
  despite attribution uncertainty. The clean days and artifact-adjusted month
  both point to A.

## Verification

- Recomputed spend totals, raw conversion totals, clean-window CPA, adjusted
  CPA, and July conversion estimates directly from the CSV files after writing
  this analysis.
- Attempted the local-instruction cross-model tail check with `claude -p`, but
  it failed with `API Error: Unable to connect to API (ConnectionRefused)`, so
  no independent model review result is available.
