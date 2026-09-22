# Recommendation: go with Channel A, not B

Short version: **marketing's read is backwards.** B only looks like the winner
because of two tracking failures in June — one that *undercounted* A and one that
*overcounted* B. Correct for both and A is the more efficient channel. If July's
$60k has to go all-in on one channel, put it on **A**. Full write-up is in
`ANALYSIS.md`.

## Why marketing's numbers are misleading

They compared recorded conversions: B 1,710 (CPA $17.5) vs A 1,150 (CPA $26.1).
Spend was genuinely $30k each (finance-reconciled), so the comparison lives or
dies on the conversion counts — and the daily data plus your ops log show both
counts are broken:

- **A was undercounted.** From 6/10-6/16, A recorded **exactly 0** conversions
  for 7 straight days — the exact window your pixel was down. Your own ops note
  says conversions weren't recorded but spend kept delivering. A ran a clean
  50/day every other day, so ~350 real conversions were simply dropped while A
  kept spending $7k.

- **B was overcounted.** From 6/20-6/27, B recorded **exactly 90/day** — exactly
  double its 45/day baseline — and snapped right back to 45 on 6/28. That window
  is exactly what the vendor's 6/28 batch re-import backfilled. An exact 2x that
  reverts at the re-import boundary is the classic signature of a
  double-counted import, ~360 phantom conversions.

Those two errors are almost the same size (~350 vs ~360) and point opposite ways,
which is what flipped the ranking.

## The clean comparison (no estimation needed)

Ignore both broken weeks and look only at days where both channels tracked
normally, at identical $1,000/day spend:

- **A: 50 conversions/day, every clean day.**
- **B: 45 conversions/day, every clean day.**

A is ~11% more efficient per dollar. Extending each baseline over the full month:
**A ≈ $20.00 CPA, B ≈ $22.22 CPA.** A wins on both cost and volume.

## What I'd actually do

1. **Given the all-in constraint: choose A.** It's the better-performing channel;
   the case for B is an artifact.
2. **Know that the edge is ~10%, not the 33% marketing quoted** — a lean, not a
   blowout.
3. **The bigger risk is "all-in" itself.** June's data was corrupted on *both*
   channels, so one month is thin evidence for betting the whole budget. If you
   can relax the constraint even a little, run ~70/30 toward A for one fully
   tracked month, then concentrate. If it truly must be all-in, go A — after
   confirming the pixel fix (6/17) is holding and asking the vendor to dedupe
   that 6/20-6/27 B re-import, which is the one assumption this rests on.

One flag worth raising with marketing: their summary trusted B's inflated week
while ignoring that A's week was zeroed out. Same data, read consistently, does
not support "B clearly won."
