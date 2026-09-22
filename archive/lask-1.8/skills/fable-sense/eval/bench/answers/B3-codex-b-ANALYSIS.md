# June Channel Allocation Analysis

## Recommendation

Put July's full $60k budget into **Channel A**, not Channel B.

Marketing's conclusion that B clearly won is based on raw event rows that are not comparable:

- Channel A is missing conversion rows during a documented tracking-pixel outage.
- Channel B includes duplicate conversion rows created during the documented vendor backfill period.

After correcting those instrumentation artifacts, Channel A has the better measured conversion rate: **50 conversions per $1k** versus **45 conversions per $1k** for Channel B.

## Sources Reviewed

- `data/spend.csv`: daily spend by channel.
- `data/events_a.csv`: one row per recorded Channel A conversion event.
- `data/events_b.csv`: one row per recorded Channel B conversion event.
- `ops-notes.md`: June growth-infra operational notes.
- `summary.md`: marketing's June wrap.

## Raw Marketing View

Marketing's summary matches the raw row counts:

| Channel | Spend | Raw event rows | Raw CPA |
|---|---:|---:|---:|
| A | $30,000 | 1,150 | $26.09 |
| B | $30,000 | 1,710 | $17.54 |

On this raw basis, B appears better. That view is not reliable because the source data has known operational defects during June.

## Data Quality Findings

### Channel A was undercounted

The ops log says the checkout migration broke the tracking pixel on Channel A landing pages on **2026-06-10**, and that conversions from A were not recorded while the pixel was down. It was fixed on **2026-06-17 morning**.

The event data matches that outage exactly:

- A records **50 conversions per day** on every recorded day.
- A records **0 conversions** from **2026-06-10 through 2026-06-16**.
- Spend delivery was unaffected, so those were not zero-spend days.

Conservative correction:

- Missing days: 7.
- Normal A rate: 50 conversions/day.
- Imputed missing conversions: 7 x 50 = **350**.
- Corrected A conversions: 1,150 + 350 = **1,500**.
- Corrected A CPA: $30,000 / 1,500 = **$20.00**.

### Channel B was overcounted

The ops log says the vendor attribution feed was down from **2026-06-19 through 2026-06-27**, and a batch re-import was run on **2026-06-28** to backfill **2026-06-20 through 2026-06-27**.

The B event file contains duplicate event IDs:

- Raw B rows: **1,710**.
- Unique B event IDs: **1,350**.
- Duplicate B rows: **360**.
- All 360 duplicates occur during **2026-06-20 through 2026-06-27**.
- The duplicate volume is exactly 45 duplicate rows per day for 8 days.

Corrected B conversions:

- Deduped B conversions: **1,350**.
- Corrected B CPA: $30,000 / 1,350 = **$22.22**.

## Corrected Comparison

| Channel | Spend | Raw rows | Data correction | Corrected conversions | Corrected CPA | Conversions per $1k |
|---|---:|---:|---:|---:|---:|---:|
| A | $30,000 | 1,150 | Add 350 missing outage-period conversions | 1,500 | $20.00 | 50 |
| B | $30,000 | 1,710 | Remove 360 duplicate backfill rows | 1,350 | $22.22 | 45 |

Comparable clean days tell the same story. Excluding A's pixel outage period and the vendor feed/backfill outage period leaves 14 clean days:

| Channel | Clean-day spend | Clean-day conversions | Clean-day CPA | Clean-day conversions per $1k |
|---|---:|---:|---:|---:|
| A | $14,000 | 700 | $20.00 | 50 |
| B | $14,000 | 630 | $22.22 | 45 |

Including 2026-06-19 does not change the rate comparison: A has 750 conversions on $15,000 of spend and B has 675 conversions on $15,000 of spend.

## July Implication

If July performance scales at the corrected June rate:

| July all-in choice | Budget | Expected conversions | Expected CPA |
|---|---:|---:|---:|
| A | $60,000 | 3,000 | $20.00 |
| B | $60,000 | 2,700 | $22.22 |

Choosing A instead of B is worth about **300 additional conversions** at the same $60k budget, assuming June's corrected conversion rates persist.

## Operational Notes Before July Launch

- QA Channel A tracking before spend starts, because the June miss was an instrumentation failure, not a spend-delivery failure.
- Fix or guard the vendor backfill process so duplicate event IDs cannot be counted as incremental B conversions.
- Monitor daily conversions per $1k during the first few July days; if the all-in shift changes auction dynamics materially, reassess quickly.

## Final Decision

The data does not support going all-in on B. B's apparent win is driven by duplicate backfill rows and A's missing tracking window. The corrected and clean-day comparisons both favor **Channel A**, so July's $60k should go all-in on **A**.
