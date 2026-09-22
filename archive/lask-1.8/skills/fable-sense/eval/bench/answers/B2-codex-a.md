Fixed.

The failure was not caused by CI using a meaningfully different env var. It was an order-dependent cache bug: an earlier test called `configure()`, which initialized `_settings` from defaults/env. After that, `test_env_override_wins` changed `APP_REPORT_LOCALE`, but `get_setting()` kept reading the already-cached `report_locale="en_US"`. Running `tests/test_config_override.py` by itself passed because the cache had not been initialized yet.

I changed `configlib/config.py` so env-derived values are recomputed on each read, while explicit `configure()` overrides remain persistent and still have highest precedence. I also updated `tests/test_config_override.py` so it reproduces the old stale-cache behavior even when run by itself.

Verification:

- `python -m pytest -q` -> `3 passed`
- `python -m pytest -q tests/test_config_override.py` -> `1 passed`
- `$env:APP_RETRY_BUDGET='5'; python -m pytest -q` -> `3 passed`
