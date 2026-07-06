# Recommendation: put July's $60k on Channel A, not B

Marketing's read is backwards. Their conclusion rests on the raw June numbers, but
those numbers are corrupted by two tracking incidents in `ops-notes.md`, and both of
them happen to push the same way -- deflating A and inflating B. Once you correct for
them, **A is the more efficient channel, not B.** Full write-up is in `ANALYSIS.md`.

## What actually happened to the data

Spend is clean and symmetric: a flat $1,000/day on each channel, $30k each,
finance-reconciled. So the whole A-vs-B question comes down to the conversion counts
-- and that's exactly what broke.

**Incident 1 -- Channel A was undercounted.** On 6/10 the checkout migration broke
Channel A's tracking pixel; conversions from A were not recorded until it was fixed
6/17 morning, but A kept spending the whole time. A converts at a dead-flat 50/day on
every one of the 23 days the pixel was up, so the 7 blacked-out days (6/10-6/16) cost
about **350 real conversions that never made it into the data.**

**Incident 2 -- Channel B was overcounted.** The vendor feed was down 6/19-6/27 and
got batch-re-imported on 6/28. B's daily count is exactly 90 on precisely those
re-imported days (6/20-6/27) and exactly 45 on all 22 other days. An exact 2.00x spike
landing exactly on the backfill window is a **double-count from a re-import that wasn't
de-duplicated** -- not a real surge. That's about **360 phantom conversions.**

## The corrected numbers

| | Conversions | CPA |
|---|---|---|
| **Channel A** | 1,150 -> **1,500** | $26.09 -> **$20.00** |
| **Channel B** | 1,710 -> **1,350** | $17.54 -> **$22.22** |

Marketing's "B beat A by 33% on CPA" was an artifact of A being suppressed and B being
inflated at the same time. On corrected data **A wins by about 10%.**

## How confident, and the one caveat

The A fix is essentially certain -- A demonstrably ran spend and converts at a flat
50/day everywhere the pixel worked. The recommendation to pick A over B hinges on
reading B's spike as a double-count, which the evidence strongly supports (exactly 2x,
exactly on the re-import window, restores B to a perfectly flat 45/day). Even if you
refuse that correction and take B's 1,710 at face value, B's apparent edge then rests
entirely on the 8 days the tracking was known to be broken -- the least trustworthy
days of the month. Either way, **the all-in-on-B plan is the weakest option and should
be rejected.**

## What I'd do

1. **All-in on Channel A** for July's $60k.
2. **Before launch, fix the tracking**: confirm A's pixel fires after the checkout
   migration, and make the vendor re-import idempotent so a backfill can't double-count
   again. Do this regardless of channel choice -- otherwise July's numbers will be just
   as untrustworthy as June's.
3. Worth flagging: going all-in on a single channel throws away all diversification.
   The data forced that here, but a clean month of tracking would let you split and
   measure properly instead of betting $60k on a month you already know was mis-measured.
