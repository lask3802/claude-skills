Fixed the intermittent pipeline blocker.

Root cause was not the CI timezone header: `test_summary_deterministic` strips the generated-at line before comparing. The nondeterminism came from `build_summary()` joining a Python `set`, so `Tags seen` could come out in different orders across processes/hash seeds.

Changed `report.py` to preserve first-seen tag order with a list plus a membership set. Duplicate tags are still collapsed, and the output now consistently matches `mobile, eu, web`.

Verification:
- `python -m pytest -q` -> `1 passed`
- `PYTHONHASHSEED=1..20` repeated pytest runs -> all passed

The timezone cleanup from issue #142 can still be handled separately after the release.
