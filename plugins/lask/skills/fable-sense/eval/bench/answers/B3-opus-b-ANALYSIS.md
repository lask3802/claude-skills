# June Channel Review — Corrected Analysis

## Bottom line

**Marketing's conclusion is backwards. After correcting two data-quality defects in the June logs, Channel A is the better performer, not Channel B.**

| Metric (June, $30k each) | Channel A | Channel B |
|---|---|---|
| Raw conversions (as logged) | 1,150 | 1,710 |
| Raw CPA | $26.09 | $17.54 |
| **True conversions (corrected)** | **1,500** | **1,350** |
| **True CPA (corrected)** | **$20.00** | **$22.22** |

The raw numbers marketing used are corrupted by two *independent* logging bugs that happen to both point the same way — they make A look worse and B look better than reality. Correcting them flips the ranking: **A converts at $20.00 vs B at $22.22, and A drives more total conversions (1,500 vs 1,350).**

**Recommendation: put July's $60k all-in on Channel A, not B.**

---

## What marketing reported

From `summary.md`: A = 1,150 conversions (CPA $26.1), B = 1,710 (CPA $17.5), "B beat A by nearly 33% on CPA," recommend consolidating into B.

Those raw counts are real row counts in the data — but they are not measuring the same thing for both channels, because of two events in the June ops log (`ops-notes.md`). Both must be corrected before any comparison is valid.

---

## Defect 1 — Channel A is under-counted (tracking pixel outage, 6/10–6/16)

**Ops log (6/10):** "checkout migration broke the tracking pixel on the channel-A landing pages — conversions from A were NOT recorded while the pixel was down. Spend delivery was unaffected. Fixed on 6/17 morning."

**What the data shows.** Channel A records exactly **50 conversions/day on every single day of June except 6/10–6/16, which are all zero**:

```
6/01–6/09   50/day   (clean)
6/10–6/16    0/day   (pixel down — nothing recorded)
6/17–6/30   50/day   (clean, resumes the morning of the fix)
```

Spend continued at $1,000/day throughout (confirmed in `spend.csv`), and A resumes at exactly 50/day the instant the pixel is fixed. So these are **7 days of real conversions that were never logged**, not 7 days of zero sales. A's rate is dead-flat at 50/day on all 23 unaffected days, so the missing volume is:

> 7 days × 50/day = **350 lost conversions**
> True A total = 1,150 + 350 = **1,500** → CPA = $30,000 / 1,500 = **$20.00**

This is a conservative estimate: A never deviates from 50/day on any clean day, so imputing 50/day for the outage window carries essentially no uncertainty.

---

## Defect 2 — Channel B is over-counted (backfill double-count, 6/20–6/27)

**Ops log (6/19):** vendor attribution feed outage, feed down through 6/27.
**Ops log (6/28):** "ran the vendor's batch re-import to backfill the 6/20–6/27 attribution feed after their outage. Import completed without errors."

**What the data shows.** Channel B runs a clean 45 conversions/day all month — **except 6/20–6/27, which each show 90/day, exactly double.** That window is precisely the range the 6/28 batch re-import touched.

This is not a real surge; it is a duplicate import. The event IDs prove it:

- `events_b.csv` has **1,710 rows but only 1,350 unique `event_id`s** — exactly **360 duplicates**.
- Every duplicate falls inside 6/20–6/27. On each of those 8 days the ID range spans only 45 unique IDs but contains 90 rows — **each conversion is logged twice**.
- 8 days × 45 duplicated IDs = 360 phantom conversions.

The 6/28 re-import re-inserted records that were already present, double-counting the whole outage window. Removing the duplicates:

> True B total = 1,710 − 360 = **1,350** → CPA = $30,000 / 1,350 = **$22.22**

(Channel A has zero duplicate IDs — it was unaffected by the feed outage, only by its own pixel bug.)

---

## Corrected economics

| | Channel A | Channel B |
|---|---|---|
| Spend | $30,000 | $30,000 |
| True conversions | **1,500** | **1,350** |
| True CPA | **$20.00** | **$22.22** |
| Conversions per $1k | 50 | 45 |

A is **~11% cheaper per acquisition** and delivers **~11% more conversions** for the same spend.

---

## Robustness check — compare only clean days (no imputation)

To remove any doubt about estimating A's missing days, compare the two channels using **only days where both had trustworthy tracking** — excluding A's outage (6/10–6/16) and B's duplicate window (6/20–6/27). That leaves 15 clean, overlapping days (6/01–6/09, 6/17–6/19, 6/28–6/30):

- On **every one** of those 15 days: **A = 50 conv/day, B = 45 conv/day** at identical $1,000/day spend.
- A: 750 conv on $15k → **$20.00 CPA**. B: 675 conv on $15k → **$22.22 CPA**.

This makes zero assumptions and reaches the identical answer: **A out-converts B on equal spend on every clean day.** The corrected-total method and the clean-day method agree exactly.

---

## Why the raw numbers were so misleading

The two bugs are independent (a checkout migration on A's landing pages; a vendor feed outage + re-import affecting B) but they distort the comparison in the *same direction*:

- Defect 1 removed 350 real conversions **from A** (understates A).
- Defect 2 added 360 phantom conversions **to B** (overstates B).

The combined ~710-conversion swing is entirely artifactual. It inflated the apparent A-vs-B gap into a "B wins by 33% on CPA" story when the truth is the reverse. Anyone reading the raw logs without the ops context would reach marketing's conclusion — which is exactly why the ops log has to be reconciled against the data before deciding.

---

## Caveats for the all-in decision

1. **Diminishing returns at 2× spend.** June economics are measured at $1,000/day per channel. July puts $2,000/day into a single channel; CPA may rise as the best audience saturates. This risk applies to whichever channel is chosen, and A wins on both CPA *and* volume-per-dollar, so it does not change the pick — but do not assume July yields a flat $20 CPA × 3,000 conversions. Consider ramping and watching CPA rather than dumping the full budget on day one.
2. **All-in concentration risk.** Going 100% into one channel removes the diversification that would otherwise hedge another tracking/feed outage. If the mandate allows any split, a heavy-A allocation (e.g. 80/20) captures most of A's advantage while retaining a live signal on B. If it must be all-in, it should be all-in on **A**.
3. **Fix the pipeline.** The pixel gap and the double-import are both silent data-integrity failures that nearly drove a six-figure misallocation. Add duplicate-ID detection on ingest and a per-channel daily-volume alert so the next outage is caught in-month.

---

## Recommendation

**Allocate July's $60k to Channel A.** On corrected June data A delivers a $20.00 CPA versus B's $22.22 and more conversions per dollar — the opposite of the raw-number reading. At A's rate, $60k buys roughly **3,000 conversions**; the same $60k on B buys roughly **2,700**. Choosing A over B is worth on the order of **~300 additional conversions in July** for the same budget. Ramp spend rather than committing the full daily amount immediately, and instrument the ingest pipeline so silent logging bugs can't corrupt the next decision.
