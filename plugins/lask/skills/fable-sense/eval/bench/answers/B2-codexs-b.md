Fixed.

The CI env var theory was not the actual cause. `.github/workflows/ci.yml` only sets `APP_RETRY_BUDGET=5`, and the suite failed the same way locally without that env var. The real issue was test-order-dependent process state: `test_flags_override` called `configure()`, which initialized the global `_settings` cache with the default `report_locale=en_US`. Later, `test_env_override_wins` set `APP_REPORT_LOCALE=zh_TW`, but `get_setting()` returned the stale cached value instead of re-merging environment values.

I changed `configlib/config.py` so explicit `configure()` overrides are tracked separately from environment/default settings. `get_setting()` now rebuilds the effective settings from defaults, current `APP_*` env vars, then explicit overrides, preserving the documented precedence: explicit configure > environment > defaults.

Verification run:

```powershell
python -m pytest -q
# 3 passed

$env:APP_RETRY_BUDGET='5'; python -m pytest -q
# 3 passed

python -m pytest -q tests\test_config_override.py
# 1 passed
```
