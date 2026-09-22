# `test_summary_deterministic` intermittent failure — root cause and fix

## TL;DR
The timezone theory (issue #142) is a red herring. The real cause is that `build_summary`
collects tags in a **`set()`**, and `", ".join(tags)` renders them in an order that depends on
`PYTHONHASHSEED`. That seed is randomized per Python process, so each CI run gets a fresh
order and the test passes only when the seed happens to yield the expected order. I changed
the tag collector to preserve first-seen insertion order, which is deterministic and matches
`EXPECTED_BODY`. The test now passes on every run.

## Why it's not the timezone
The header line is `f"Daily summary generated at {now_str()}"`, and `now_str()` returns a
single line (`"%Y-%m-%d %H:%M"`). The test explicitly drops that line before comparing:

```python
body = "\n".join(summary.splitlines()[1:])   # strips the whole "generated at ..." line
assert body == EXPECTED_BODY
```

So the time (and therefore the UTC-vs-UTC+8 offset) never reaches the compared text. UTC vs
UTC+8 only changes the header, which is discarded. The comment in `report.py` pointed the
investigation at the wrong place.

## The actual cause
Every failing diff is in the last line:

```
- Tags seen: mobile, eu, web     (expected)
+ Tags seen: eu, mobile, web     (one observed failure)
```

`tags` was a `set`, and iterating a set of strings uses hash order, which Python randomizes
per process via `PYTHONHASHSEED` (on by default since 3.3). Demonstration — same three tags,
different seeds, different order:

```
seed 0 -> eu, mobile, web
seed 1 -> mobile, eu, web
seed 2 -> web, mobile, eu
seed 3 -> web, eu, mobile
...
```

Only some seeds produce the expected `mobile, eu, web`, so the test passes intermittently —
consistent with your teammate's "about one run in three." (Fresh local processes matched the
expected order roughly 1 in 4; under pytest it was lower, ~1 in 12. Either way it's a coin
flip driven entirely by the hash seed, not the environment's clock or timezone.)

The `Actions:` block was never the problem: `actions` is a `dict`, which preserves insertion
order, so `login / purchase / logout` is always stable.

## The fix
`report.py` — replace the `set` with an insertion-ordered collector (a dict used as an ordered
set), so tags render in first-seen order. That order is exactly what `EXPECTED_BODY` encodes
(`mobile, eu, web`), so the test is now correct-by-construction rather than seed-dependent.

```python
    actions = {}
    # Ordered set: preserve first-seen order so the rendered tag list is
    # deterministic. A plain set() iterates in PYTHONHASHSEED-dependent
    # order, which made this report vary between runs (issue #142).
    tags = {}
    for rec in records:
        actions[rec["action"]] = actions.get(rec["action"], 0) + 1
        for t in rec["tags"]:
            tags.setdefault(t, None)
```

`", ".join(tags)` iterates the dict's keys in insertion order, so the output is deterministic.
I also removed the misleading timezone `NOTE` comment.

I did not touch the test. `EXPECTED_BODY` already specifies the correct (first-seen) order;
the bug was in the production code, not the expectation.

## Note on intent
I chose insertion order (not `sorted()`) deliberately: `EXPECTED_BODY` lists tags as
`mobile, eu, web`, which is first-seen order, not alphabetical (`eu, mobile, web`). Preserving
insertion order fixes the flake without changing the report's documented output. If you'd
rather the digest list tags alphabetically, that's a one-line change to `sorted(tags)` plus
an update to `EXPECTED_BODY` — let me know and I'll switch it.

## Verification
- Before the fix: `PASS=2 FAIL=22` over 24 pytest runs (flaky).
- After the fix: `PASS=30 FAIL=0` over 30 pytest runs.
- After the fix, forcing adversarial seeds `PYTHONHASHSEED=0..9`: all 10 PASS.

Repro / confirm:
```
python -m pytest -q
# and to prove seed-independence:
for s in 0 1 2 3 4 5; do PYTHONHASHSEED=$s python -m pytest -q; done
```
