Fixed.

The CI env var was not the direct cause. `APP_RETRY_BUDGET=5` still let
`tests/test_config_override.py` pass by itself. The real problem was test-order
state leakage: `tests/test_app_flags.py` called `configure(feature_flags=...)`
first, which initialized the cached `_settings` dict with the default
`report_locale=en_US`. Later, `test_env_override_wins` patched
`APP_REPORT_LOCALE=zh_TW`, but `get_setting("report_locale")` read the stale
cached value.

I changed `configlib/config.py` so explicit `configure()` overrides are stored
separately from defaults/env values. `get_setting()` now rebuilds defaults plus
current `APP_*` env and then applies explicit overrides, so configuring one key
does not freeze unrelated settings. I also added a regression test covering
that exact behavior.

Verification:

- Reproduced the original ordered failure before the fix with
  `python -m pytest -q tests\test_app_flags.py tests\test_config_override.py`.
- Ran `python -m pytest -q`: `4 passed`.
- Ran with the CI env var set, `$env:APP_RETRY_BUDGET='5'; python -m pytest -q`:
  `4 passed`.
