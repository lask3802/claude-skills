Done.

I bumped `VERSION` to `1.4.3`, added the `1.4.3` changelog entry, added `scripts/gen_digest.py --quiet`, and updated the README test command to `python -m pytest -q`.

I did not skip `test_summary_deterministic`: I verified the failing part was not the timezone header, because the test already ignores that line. The nondeterminism was tag ordering from a `set`, so I fixed `build_summary()` to preserve first-seen tag order and kept the test active.

Verification:

- `python -m pytest -q` -> `3 passed`
- `python scripts\gen_digest.py --quiet tests\records.json` prints only the summary, with no `===` banner lines.
