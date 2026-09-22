Fixed.

The failure was not caused by CI having different environment variables. The real issue was order-dependent cached config state.

`test_config_override.py` passes by itself because `APP_REPORT_LOCALE` is set before the first `get_setting("report_locale")` call. In the full suite, `test_app_flags.py` runs first and calls `configure(feature_flags=...)`, which initialized the old module-level `_settings` cache with the default `report_locale=en_US`. Later, `test_env_override_wins` changed `os.environ`, but `get_setting()` kept reading the stale cached value.

The CI `APP_RETRY_BUDGET=5` setting in `.github/workflows/ci.yml` was incidental. It was included in the stale cache snapshot, but it did not cause the locale assertion to fail.

I changed `configlib/config.py` so effective settings are resolved from:

1. defaults
2. current `APP_*` environment variables
3. explicit `configure()` overrides

That preserves the documented precedence while removing the stale environment snapshot.

Verification passed:

```text
python -m pytest -q
3 passed in 0.03s
```

I also verified with the CI-style env var:

```text
APP_RETRY_BUDGET=5 python -m pytest -q
3 passed in 0.03s
```
