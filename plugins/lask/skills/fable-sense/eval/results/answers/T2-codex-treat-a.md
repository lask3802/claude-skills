Implemented `dedupe(events)` in `pipeline/dedupe.py` and added focused coverage in `test_dedupe.py`.

The stage now streams lazily, dedupes retry traffic within the gateway redelivery window from `config/gateway.yaml`, ignores retry-only metadata (`attempt`, `sent_at`) for ID-bearing events, preserves same-ID events when stable content differs, and bounds memory with second-level retention buckets instead of an unbounded `seen` set.

Verification:
- `python -m unittest discover -v` passed: 5 tests.
- `python -m compileall -q pipeline test_dedupe.py` passed.
- Direct sample run over `data/events_sample.jsonl` produced 11 output events, dropping retry duplicates for `ev-7f01`, `ev-7f02`, and `ev-7f04` while preserving both distinct `ev-7f08` payloads.

Residual note: I attempted the requested adversarial tail check with `claude -p`, but the command timed out after 120 seconds without returning findings.
