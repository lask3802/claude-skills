Implemented `dedupe(events)` in `pipeline/dedupe.py`.

The stage now streams events, drops retry/redelivery duplicates within the 10-minute gateway window, and keeps memory bounded for long-lived edge workers. Event identity is based on stable business fields (`event_id`, `device_id`, `type`, `schema_v`, and `payload`), while retry metadata like `attempt` and `sent_at` is ignored. Events without a usable `event_id` or serializable identity pass through rather than risking false drops.

Added focused unittest coverage in `tests/test_dedupe.py` plus `tests/__init__.py` so default discovery runs it. The sample traffic now drops the real retries while preserving the reused `event_id` with a different payload.

Verification: `$env:PYTHONDONTWRITEBYTECODE='1'; python -m unittest discover -v` passes 3 tests.
