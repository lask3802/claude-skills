# June channel analysis

## Recommendation

Put July's full $60k into **channel A**, not channel B.

Marketing's headline comparison uses the raw June totals:

| Channel | Spend | Raw conversions | Raw CPA |
| --- | ---: | ---: | ---: |
| A | $30,000 | 1,150 | $26.09 |
| B | $30,000 | 1,710 | $17.54 |

Those totals are not a reliable basis for July allocation because June had two tracking/attribution incidents that directly distort the channel comparison.

## What the data shows

Spend was equal and stable: `data/spend.csv` has $1,000 per channel per day for all 30 days.

Daily conversion counts:

| Period | Days | A events/day | B events/day | Notes |
| --- | ---: | ---: | ---: | --- |
| 2026-06-01 to 2026-06-09 | 9 | 50 | 45 | Clean period before A pixel outage |
| 2026-06-10 to 2026-06-16 | 7 | 0 | 45 | A pixel was broken per `ops-notes.md` |
| 2026-06-17 to 2026-06-19 | 3 | 50 | 45 | A recovered; before B vendor backfill window |
| 2026-06-20 to 2026-06-27 | 8 | 50 | 90 | B doubles exactly during vendor outage/backfill window |
| 2026-06-28 to 2026-06-30 | 3 | 50 | 45 | Back to prior run rate |

The clean apples-to-apples days are June 1-9, June 17-19, and June 28-30: 15 days with no visible A pixel outage and no B backfill spike.

On those clean days:

| Channel | Spend | Conversions | CPA |
| --- | ---: | ---: | ---: |
| A | $15,000 | 750 | $20.00 |
| B | $15,000 | 675 | $22.22 |

Channel A is better on the clean comparison: 50 conversions/day vs B's 45 conversions/day, and $20.00 CPA vs B's $22.22 CPA.

## Why marketing's conclusion is misleading

### A is undercounted

`ops-notes.md` says the channel-A tracking pixel was broken on the A landing pages from June 10 until the morning of June 17, and that conversions from A were not recorded while the pixel was down. The raw file shows exactly that: A has 0 conversions on June 10-16 while spend continued at $1,000/day.

A's observed run rate outside the broken-pixel window is perfectly stable at 50 conversions/day. A reasonable correction for the seven missing days is:

- Observed A conversions outside outage: 1,150 across 23 recorded days
- A clean run rate: 50/day
- Estimated missing conversions: 7 days * 50/day = 350
- Corrected A estimate: 1,500 conversions
- Corrected A CPA: $30,000 / 1,500 = $20.00

### B's apparent win comes from an attribution anomaly

`ops-notes.md` says the vendor attribution feed was down through June 27 and was batch re-imported on June 28 for June 20-27. In `data/events_b.csv`, B is 45 conversions/day before and after that window, but exactly 90 conversions/day on June 20-27.

That 8-day window contributes 720 B conversions instead of the normal 360. The extra 360 events are the difference between B looking worse than A and B looking like the clear winner.

Normalizing B's June 20-27 window back to its stable 45/day run rate gives:

- Normalized B estimate: 1,350 conversions
- Normalized B CPA: $30,000 / 1,350 = $22.22

Even if the backfilled B rows are not proven duplicates, the spike is not decision-grade evidence for an all-in July shift. It occurs exactly in the vendor outage/backfill window, has no corresponding spend increase, and immediately disappears afterward.

## Decision

Use the clean measured performance, not the contaminated raw aggregate:

| Basis | A CPA | B CPA | Winner |
| --- | ---: | ---: | --- |
| Raw totals | $26.09 | $17.54 | B |
| Clean comparable days | $20.00 | $22.22 | A |
| Corrected/normalized June estimate | $20.00 | $22.22 | A |

July has to go all-in on one channel. Based on the comparable data, choose **channel A**.

The residual risk is that B's June 20-27 backfill spike could reflect real incremental conversions rather than duplicated or otherwise contaminated attribution. I would not bet the full July budget on that interpretation without event-level deduplication or vendor confirmation, because every clean day shows A outperforming B.
