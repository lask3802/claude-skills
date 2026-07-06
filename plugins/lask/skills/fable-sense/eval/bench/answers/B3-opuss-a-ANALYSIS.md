# June channel review — corrected analysis

**Bottom line:** Marketing's conclusion is backwards. Once you correct for two
documented data-tracking failures, **Channel A is the more efficient channel**,
not B. The raw numbers that made B look like the winner are artifacts of (1) a
week where A's conversions went unrecorded and (2) a week where B's conversions
were double-counted. If July's $60k must go all-in on one channel, it should go
to **A** — and marketing's recommendation to go all-in on B is based on
corrupted data.

---

## 1. What marketing reported

| Channel | Spend | Conversions (recorded) | CPA |
|---|---|---|---|
| A | $30,000 | 1,150 | $26.09 |
| B | $30,000 | 1,710 | $17.54 |

On these raw numbers B looks ~33% cheaper per conversion. **But the recorded
conversion counts are not trustworthy** — the ops log documents two incidents
that distort them in opposite directions.

## 2. The daily data exposes both distortions

Spend is finance-reconciled: exactly $1,000/day per channel, all 30 days, no
gaps. So any day-to-day movement in conversions is a tracking story, not a
spend story. Daily recorded conversions:

| Window | Channel A / day | Channel B / day | What the ops log says |
|---|---|---|---|
| 6/01-6/09 | 50 | 45 | normal |
| **6/10-6/16** | **0** | 45 | A landing-page **pixel broke 6/10, fixed 6/17** — "conversions from A were NOT recorded while the pixel was down. Spend delivery was unaffected." |
| 6/17-6/19 | 50 | 45 | A back to normal |
| **6/20-6/27** | 50 | **90** | vendor feed outage 6/19-6/27; **6/28 batch re-import backfilled 6/20-6/27** |
| 6/28-6/30 | 50 | 45 | B back to normal |

Two things jump out:

- **Channel A recorded exactly 0 conversions for 7 straight days (6/10-6/16)** —
  the exact window the pixel was down — and a clean 50/day on every one of the
  other 23 days. A was still spending $1,000/day and still driving conversions
  that whole week; they just weren't recorded. **~350 real A conversions were
  dropped** (7 days x 50/day).

- **Channel B recorded exactly 90/day for 8 days (6/20-6/27)** — exactly double
  its 45/day baseline — and reverts to exactly 45/day the moment the backfilled
  window ends (6/28). This window is precisely the range the vendor's 6/28
  re-import covered. A jump to *exactly* 2x that snaps back to baseline at the
  re-import boundary is the fingerprint of a **double-counted re-import**, not
  real performance. **~360 phantom B conversions** (8 days x 45/day).

Note the two errors are near-equal in size (~350 vs ~360) and point in
opposite directions, so together they create a ~560-conversion swing in B's
favor in the raw totals — enough to flip the ranking.

## 3. The clean, assumption-free comparison

Throw out both contaminated windows entirely and compare only the days where
both channels were tracked normally. This needs no estimation:

- **Channel A: 50 conversions/day on every one of its 23 clean days.**
- **Channel B: 45 conversions/day on every one of its 22 clean days.**
- Identical spend: $1,000/day each.

On matched, uncontaminated days at identical spend, **A converts ~11% more per
dollar than B**. This holds without extrapolating anything.

## 4. Corrected full-month view

Extending each channel's stable baseline across all 30 days:

| Channel | Spend | True conversions | True CPA |
|---|---|---|---|
| **A** | $30,000 | ~1,500 (50/day x 30) | **$20.00** |
| **B** | $30,000 | ~1,350 (45/day x 30) | **$22.22** |

A wins on both efficiency (lower CPA) and true volume.

## 5. Sensitivity — does the conclusion survive doubt?

The one load-bearing inference is that B's 6/20-6/27 doubling is an artifact.
It is very well supported (exact 2x, exact alignment to the documented re-import
window, exact reversion at the boundary, and A shows no matching organic surge).
But even under conservative alternatives, B never "clearly wins":

- **Correct only A's undercount, take B's 1,710 at face value:** A $20.00 vs
  B $17.54 — B ahead, *but only if you believe the exact-2x backfill window is
  real*, which the evidence contradicts.
- **Correct only B's overcount, take A's 1,150 at face value:** A $26.09 vs
  B $22.22 — B ahead, *but only if you ignore the explicit ops note that A's
  conversions went unrecorded*.
- **Correct both (the honest reading):** A $20.00 vs B $22.22 — **A ahead.**
- **Correct neither (clean-day baselines only):** A 50/day vs B 45/day — **A
  ahead**, no estimation required.

The only readings where B wins require selectively trusting one broken window
while ignoring the other. Marketing's summary did exactly that. Under any
internally consistent treatment of the data, **B is not the clear winner**, and
under the honest full correction, **A is ahead.**

## 6. Recommendation

**If July's $60k must go all-in on one channel, choose A**, not B. A is the more
efficient channel (~$20 vs ~$22 CPA, ~50 vs ~45 conv/day at equal spend), and
the case for B rests entirely on data-tracking artifacts.

Two caveats worth stating plainly:

1. **The margin is real but modest (~10%), not the 33% marketing claimed.** A is
   the better bet, but this is a lean, not a landslide.
2. **"All-in on one channel" is itself the riskiest part of the plan.** June's
   data was corrupted on both channels, and one clean month is thin evidence for
   betting an entire budget. If the all-in constraint can be relaxed at all, the
   stronger move is to split (e.g. 70/30 toward A) for one clean, fully-tracked
   month, then concentrate. If it truly cannot be relaxed, go A — and this time
   confirm the pixel and the attribution feed are healthy before spending.

### Action items before committing $60k
- Have the vendor confirm whether the 6/20-6/27 B re-import double-wrote rows
  (dedupe by event_id / timestamp). This validates the single key assumption.
- Confirm the channel-A pixel fix (6/17) is holding in early July.
