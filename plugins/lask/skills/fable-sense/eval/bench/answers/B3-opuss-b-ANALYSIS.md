# June Channel Review — Corrected Analysis

## Bottom line

**Do not go all-in on B. Marketing's conclusion is wrong.** The raw June numbers
are corrupted by two separate tracking incidents documented in `ops-notes.md`, and
**both errors happen to inflate B relative to A**. After correcting for them, the
better performer is **Channel A** (true CPA ≈ **$20.00** vs B's **$22.22**).

| View | A conversions | A CPA | B conversions | B CPA | Apparent winner |
|---|---|---|---|---|---|
| Marketing's raw numbers | 1,150 | $26.09 | 1,710 | $17.54 | B (by ~33%) |
| **Corrected best estimate** | **1,500** | **$20.00** | **1,350** | **$22.22** | **A (by ~10%)** |

Spend is identical and finance-reconciled ($30k each, a flat $1,000/day for all 30
days on both channels), so the entire comparison rides on the conversion counts —
and those counts are exactly what the incidents broke.

## What the raw data actually looks like

Daily recorded conversions per channel:

| Window | Channel A | Channel B | Note |
|---|---|---|---|
| 6/01 - 6/09 | 50/day | 45/day | clean |
| **6/10 - 6/16** | **0/day** | 45/day | A pixel down (incident 1) |
| 6/17 - 6/19 | 50/day | 45/day | A pixel restored |
| **6/20 - 6/27** | 50/day | **90/day** | B feed backfilled (incident 2) |
| 6/28 - 6/30 | 50/day | 45/day | clean |

Outside its own incident window, **each channel's daily count is perfectly flat**:
A records exactly **50/day on all 23 non-incident days**, and B records exactly
**45/day on all 22 non-incident days**. There is no natural day-to-day variance in
this dataset, which makes the two anomalies unmistakable rather than noise.

## The two incidents (from `ops-notes.md`) and their effect

### Incident 1 - Channel A undercounted (6/10 -> 6/17 morning)

> 6/10: checkout migration broke the tracking pixel on the channel-A landing pages
> - conversions from A were NOT recorded while the pixel was down. Spend delivery
> was unaffected. Fixed on 6/17 morning.

For 7 days (6/10-6/16) A's conversions were **not recorded, but A kept spending
$1,000/day**. A's true daily rate is a rock-steady 50 on every other day, so the
missing conversions are ~ **7 x 50 = 350** that really happened but never landed in
the data.

- Corrected A conversions: 1,150 + 350 = **1,500** (= 50/day x 30 days)
- This correction is close to certain: A demonstrably ran spend and converts at a
  flat 50/day for all 23 days the pixel was up.

### Incident 2 - Channel B overcounted (6/19 outage -> 6/28 re-import)

> 6/19: vendor attribution feed outage ... feed down through 6/27.
> 6/28: ran the vendor's batch re-import to backfill the 6/20-6/27 attribution feed
> after their outage. Import completed without errors.

B's counts **double to exactly 90/day on precisely 6/20-6/27** - the exact 8-day
window that was re-imported on 6/28 - then drop straight back to 45. This is the
classic signature of a **non-idempotent re-import**: the 6/20-6/27 conversions were
counted once and then the batch backfill added the same rows a second time.
"Completed without errors" is consistent with this - a clean re-run still
double-counts if it doesn't de-duplicate against rows already present.

- Phantom conversions: ~ **8 x 45 = 360**
- Corrected B conversions: 1,710 - 360 = **1,350** (= 45/day x 30 days)

Why double-count rather than a real surge: (a) the spike is *exactly* 2.00x the base
rate, not an organic-looking lift; (b) it coincides day-for-day with the re-import
window and nothing in ops-notes indicates a B promo; (c) removing it restores B to a
perfectly flat 45/day matching all 22 other days. A genuine surge would not be
exactly double and would not align exactly with the backfill.

Note both errors push the same way: A is deflated, B is inflated - which is exactly
why the raw comparison so badly overstates B.

## Corrected result

| Channel | Spend | True conversions | True CPA |
|---|---|---|---|
| **A** | $30,000 | **1,500** | **$20.00** |
| **B** | $30,000 | **1,350** | **$22.22** |

**Channel A is the more efficient channel by roughly 10% on CPA.** This is the
opposite of marketing's read, and the reversal is driven entirely by data-quality
artifacts, not by any change in the channels' real performance.

## Sensitivity - does the recommendation hold?

The A-undercount fix (Incident 1) is essentially undeniable. The recommendation's
strength depends on how you treat B's 6/20-6/27 spike:

| Assumption about B's spike | A CPA | B CPA | Winner |
|---|---|---|---|
| **Double-count artifact (best supported)** | $20.00 | $22.22 | **A** |
| Half real / half duplicate | $20.00 | ~$19.80 | ~ tie |
| **100% real surge (most B-favorable)** | $20.00 | $17.54 | B, but see below |

Even in the extreme "spike is 100% real" case, B's advantage is **not** the 33% CPA
gap marketing cited - that gap only existed because A was simultaneously undercounted.
B's edge in that scenario rests entirely on **8 anomalous days that fall exactly on a
known data-integrity incident**, i.e. the least trustworthy 8 days in the month.
On the 22 clean days, A (50/day, CPA $20) simply beats B (45/day, CPA $22.22).

## Recommendation

1. **Reject the all-in-on-B plan.** It is built on numbers that two documented
   incidents corrupted, both in B's favor. "B won by 33%" is not true under any
   defensible reading.
2. **If July's $60k must go all-in on one channel, put it on Channel A.** On clean,
   artifact-free days A converts at a higher rate for the same spend (CPA $20.00 vs
   $22.22). The only scenario where B looks better requires trusting the exact 8 days
   the tracking was known to be broken.
3. **Before launching July, fix the tracking so the next decision isn't guesswork:**
   confirm the channel-A pixel fires post-checkout-migration, and make the vendor
   re-import idempotent/de-duplicated so a backfill can't double-count again. A month
   of clean data would let you compare A vs B on their merits - and would de-risk
   committing the full $60k to a single channel, which itself gives up all
   diversification against exactly this kind of data or performance surprise.

## Method / reproducibility

- Spend: `data/spend.csv` - flat $1,000/day x 30 days x 2 channels = $30k each
  (matches marketing and the 6/30 finance reconciliation).
- Conversions: counted one row per event in `data/events_a.csv` (1,150) and
  `data/events_b.csv` (1,710); aggregated by day.
- Corrections impute each channel's own flat base rate (A = 50/day, B = 45/day)
  across its incident window; every non-incident day already sits exactly on that
  rate, so 1,500 and 1,350 are just 30 x base rate.
