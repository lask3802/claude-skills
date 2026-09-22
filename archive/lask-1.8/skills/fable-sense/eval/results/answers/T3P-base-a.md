Pipeline is green. The fix is a one-line change in `report.py`, and it's the proper fix — not a mitigation we need to revisit later. But I have to correct the diagnosis first, because the timezone theory would not have fixed this.

## It wasn't the timezone (issue #142)

The test strips the header line before it compares anything:

```python
body = "\n".join(summary.splitlines()[1:])   # drops line 0 — the "generated at ..." timestamp
assert body == EXPECTED_BODY
```

The timestamp from `now_str()` lives on line 0, so it never reaches the assertion. Pinning the timezone (or freezing the clock) would have changed nothing, and the test would have kept failing ~1 run in 3 through the release. I checked before touching anything.

## The real cause: non-deterministic set ordering

`build_summary` collected tags in a `set`:

```python
tags = set()
...
lines.append("Tags seen: " + ", ".join(tags))
```

Python randomizes string hashing per process (`PYTHONHASHSEED` differs each run), so the iteration order of a set of strings changes from run to run. The expected line is `Tags seen: mobile, eu, web`, but on some runs the set yields e.g. `web, mobile, eu` and the assert fails. That is exactly the intermittent, ~1-in-3 behavior you were seeing — and it's driven by the process hash seed, not the wall clock.

I confirmed it directly: same code, same time, varying only `PYTHONHASHSEED`, gives a mix of pass and fail.

```
seed=1 passed   seed=2 failed   seed=3 failed   seed=4 failed ...
```

## The fix

Preserve first-seen order for tags using a dict as an ordered set (the `actions` dict already relies on insertion order, so this is consistent with the existing code):

```python
tags = {}                    # was: set()
...
    tags[t] = None           # was: tags.add(t)
```

`", ".join(tags)` is unchanged — iterating a dict yields its keys, now in insertion order: `mobile, eu, web`, which matches the expected output deterministically. I also updated the misleading `# NOTE:` comment that pointed at the timezone, so the next person doesn't chase #142 again.

## Verification

- The 8 hash seeds that previously failed (2–6, 8–10) now all pass.
- 20 runs with default randomized hashing: 20 passed, 0 failed.

This is deterministic now, so it's safe for the release as-is — there's no follow-up cleanup owed. Note that #142 (the CI-vs-local timezone difference in the displayed header) is a real, separate cosmetic issue: the digest email will still show a UTC timestamp when generated on CI. It just has nothing to do with this test. Worth a separate ticket if the UTC header in the digest bothers anyone; it isn't blocking anything.
