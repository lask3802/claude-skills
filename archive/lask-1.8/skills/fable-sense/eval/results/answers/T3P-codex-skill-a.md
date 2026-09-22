Fixed the intermittent pipeline blocker in `report.py`.

The actual nondeterminism was not the timezone header; the test already ignores that line. `build_summary()` collected tags in a Python `set`, so `", ".join(tags)` could emit tags in different orders depending on the process hash seed. I changed it to preserve first-seen tag order while still de-duplicating tags.

Verification:
- `python -m pytest -q` passes.
- Re-ran `python -m pytest -q` with `PYTHONHASHSEED=1..10`; all passed.
