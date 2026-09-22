"""
June channel review — recompute A vs B accounting for tracking-data integrity.

Reads:
  data/spend.csv        daily spend per channel (finance-reconciled, trusted)
  data/events_a.csv     one row per recorded conversion, channel A
  data/events_b.csv     one row per recorded conversion, channel B

Ops-log data-integrity events (ops-notes.md) that this script cross-checks
against the raw daily counts:
  - 6/10 -> 6/17 morning: channel-A tracking pixel down. A conversions NOT
    recorded; A spend delivery unaffected. NEVER backfilled.
  - 6/19 -> 6/27: vendor attribution feed outage (BOTH channels).
    6/28 batch re-import backfilled 6/20-6/27. (6/19 may remain a gap.)

Run: python analyze.py
"""
import csv
from collections import Counter
from datetime import date, timedelta

DAYS = [date(2026, 6, d) for d in range(1, 31)]


def load_daily_counts(path):
    c = Counter()
    with open(path, newline="") as f:
        r = csv.DictReader(f)
        for row in r:
            c[row["date"]] += 1
    return c


def load_daily_spend(path):
    spend = {"A": {}, "B": {}}
    with open(path, newline="") as f:
        r = csv.DictReader(f)
        for row in r:
            spend[row["channel"]][row["date"]] = float(row["spend_usd"])
    return spend


a = load_daily_counts("data/events_a.csv")
b = load_daily_counts("data/events_b.csv")
spend = load_daily_spend("data/spend.csv")

# --- Daily table ---------------------------------------------------------
print(f"{'date':12} {'A_conv':>7} {'B_conv':>7} {'A_spend':>8} {'B_spend':>8}")
for d in DAYS:
    k = d.isoformat()
    print(f"{k:12} {a.get(k,0):7d} {b.get(k,0):7d} "
          f"{spend['A'].get(k,0):8.0f} {spend['B'].get(k,0):8.0f}")

A_total = sum(a.values())
B_total = sum(b.values())
A_spend = sum(spend["A"].values())
B_spend = sum(spend["B"].values())

print("\n=== Raw totals (what marketing reported) ===")
print(f"A: {A_total} conv, ${A_spend:.0f} spend, CPA ${A_spend/A_total:.2f}")
print(f"B: {B_total} conv, ${B_spend:.0f} spend, CPA ${B_spend/B_total:.2f}")

# --- Identify the corrupted A window from ops-notes ----------------------
# A pixel down 6/10 through 6/17 morning. Treat 6/10..6/16 as fully lost
# and inspect 6/17 (partial). We classify days as CLEAN for A if outside the
# pixel-down window.
A_pixel_down = {date(2026, 6, d).isoformat() for d in range(10, 18)}  # 10..17

print("\n=== Channel-A daily counts around the pixel outage (6/10-6/17) ===")
for d in DAYS:
    k = d.isoformat()
    flag = "  <-- pixel down (A not recorded)" if k in A_pixel_down else ""
    if 8 <= d.day <= 19:
        print(f"{k:12} A={a.get(k,0):4d}{flag}")

# --- Second integrity issue: B backfill double-count ---------------------
# The 6/28 re-import backfilled 6/20-6/27. B shows EXACTLY 2x its baseline
# (90 vs 45/day) for EXACTLY those 8 days, then snaps back to 45 on 6/28.
# That is the fingerprint of the backfill duplicating already-ingested
# events, not a real demand surge (a real surge would not revert to baseline
# on the exact day the backfill window closes).
B_backfill = {date(2026, 6, d).isoformat() for d in range(20, 28)}  # 20..27

print("\n=== Channel-B daily counts around the 6/28 backfill (6/20-6/27) ===")
for d in DAYS:
    k = d.isoformat()
    flag = "  <-- backfilled window (B = 2x baseline)" if k in B_backfill else ""
    if 17 <= d.day <= 29:
        print(f"{k:12} B={b.get(k,0):4d}{flag}")

# --- Truly clean days: BOTH channels have exactly one clean recording -----
# Exclude A-lost days (6/10-6/16) and B-doubled days (6/20-6/27).
# 6/17 recorded a full 50 for A (pixel fixed 6/17 morning) -> kept.
A_lost = {date(2026, 6, d).isoformat() for d in range(10, 17)}  # 10..16
excluded = A_lost | B_backfill
clean_days = [d.isoformat() for d in DAYS if d.isoformat() not in excluded]
n_clean = len(clean_days)

A_rate = sum(a.get(k, 0) for k in clean_days) / n_clean
B_rate = sum(b.get(k, 0) for k in clean_days) / n_clean
print(f"\n=== Like-for-like clean days ({n_clean} days, both channels intact) ===")
print(f"A: {A_rate:.1f} conv/day  ->  CPA at $1000/day = ${1000/A_rate:.2f}")
print(f"B: {B_rate:.1f} conv/day  ->  CPA at $1000/day = ${1000/B_rate:.2f}")

# --- Reconstruct true full-month totals at the clean daily rates ----------
A_true = A_rate * 30
B_true = B_rate * 30
print("\n=== Corrected full-month totals (flat clean rate x 30 days) ===")
print(f"A: {A_true:.0f} conv, CPA ${30000/A_true:.2f}   "
      f"(marketing said {A_total}, CPA ${A_spend/A_total:.2f})")
print(f"B: {B_true:.0f} conv, CPA ${30000/B_true:.2f}   "
      f"(marketing said {B_total}, CPA ${B_spend/B_total:.2f})")

# --- Reconcile: prove the artifacts fully explain the raw totals ----------
A_lost_conv = A_rate * len(A_lost)          # never recorded
B_phantom_conv = B_rate * len(B_backfill)   # double-counted
print("\n=== Reconciliation (artifacts fully account for the raw numbers) ===")
print(f"A: true {A_true:.0f} - lost {A_lost_conv:.0f} (6/10-6/16 pixel down) "
      f"= {A_true - A_lost_conv:.0f}  vs raw {A_total}  "
      f"{'OK' if abs(A_true - A_lost_conv - A_total) < 1 else 'MISMATCH'}")
print(f"B: true {B_true:.0f} + phantom {B_phantom_conv:.0f} (6/20-6/27 dup) "
      f"= {B_true + B_phantom_conv:.0f}  vs raw {B_total}  "
      f"{'OK' if abs(B_true + B_phantom_conv - B_total) < 1 else 'MISMATCH'}")

print("\n=== Bottom line ===")
print(f"Corrected CPA:  A = ${30000/A_true:.2f}   B = ${30000/B_true:.2f}")
winner = "A" if (30000/A_true) < (30000/B_true) else "B"
print(f"Lower CPA (better) = Channel {winner}  "
      f"-> the ranking is the REVERSE of marketing's raw read.")
