# Recommendation: go all-in on Channel A, not B

Marketing has it backwards. Their call rests on the raw conversion counts (A = 1,150, B = 1,710), but those counts are corrupted by two separate logging bugs in June — and both bugs happen to push in B's favor. Once you correct them, **A is the cheaper, higher-volume channel.** Full write-up is in `ANALYSIS.md`.

## What the raw numbers miss

**Channel A was under-counted.** The ops log notes the checkout migration broke the channel-A tracking pixel on 6/10, fixed the morning of 6/17, and "conversions from A were NOT recorded while the pixel was down" — but spend kept delivering. The data confirms it exactly: A logs 50 conversions/day every single day of June *except* 6/10–6/16, which are all zero. Those 7 days are real conversions that were never recorded, not lost sales. That's 7 × 50 = **350 conversions missing from A**.

**Channel B was over-counted.** The vendor attribution feed went down 6/19–6/27, and on 6/28 ops ran a batch re-import to backfill 6/20–6/27. That re-import double-counted: B shows exactly 90 conversions/day for 6/20–6/27 (double its steady 45/day everywhere else). The event IDs prove it — `events_b.csv` has 1,710 rows but only 1,350 unique IDs, and all 360 duplicates fall in that backfill window, each conversion logged twice. That's **360 phantom conversions inflating B.**

## Corrected numbers (each channel spent $30k)

| | Channel A | Channel B |
|---|---|---|
| Raw conversions / CPA | 1,150 / $26.09 | 1,710 / $17.54 |
| **True conversions / CPA** | **1,500 / $20.00** | **1,350 / $22.22** |

A is about 11% cheaper per acquisition and delivers more conversions per dollar. I sanity-checked this a second way with no estimation at all: on the 15 days where *both* channels had clean tracking, A converts at 50/day and B at 45/day on identical spend — same $20.00 vs $22.22 result. The two methods agree exactly.

## Recommendation

**Put July's $60k on Channel A.** At its corrected rate that's roughly 3,000 conversions, versus ~2,700 if you'd followed marketing into B — about 300 more conversions for the same budget, and the opposite of the recommendation on the table.

Two cautions on execution:
- **Don't assume the $20 CPA holds at 2× spend.** June economics come from $1k/day; $2k/day into one channel may raise CPA as the audience saturates. Ramp and watch CPA rather than committing the whole budget day one. (This favors A regardless — it wins on both cost and volume.)
- **Fix the data pipeline.** Two silent logging failures nearly drove a $60k misallocation. Add duplicate-ID detection on ingest and a per-channel daily-volume alert so the next outage gets caught the same month.

If the mandate can flex at all, a heavy-A split (e.g. 80/20) keeps a live read on B while capturing almost all of A's advantage. If it truly must be all-in, it should be all-in on **A**.
