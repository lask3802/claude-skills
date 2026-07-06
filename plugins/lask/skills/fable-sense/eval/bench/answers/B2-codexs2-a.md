Fixed.

The failure was not caused by CI's `APP_RETRY_BUDGET=5`. The root cause was the
process-wide `_settings` cache in `configlib/config.py`: the first call to
`configure(feature_flags=...)` loaded defaults and env into one merged dict, so
`report_locale` was frozen as `en_US`. Later, `test_env_override_wins` changed
`APP_REPORT_LOCALE`, but `get_setting("report_locale")` read the stale cached
value. That is why the test passed alone and failed after `test_app_flags.py`.

I changed config handling so explicit `configure()` overrides are tracked
separately from default/env-backed values. Now an unrelated explicit override
does not freeze every other setting, while an explicit override for the same key
still wins over the environment.

Changed files:

- `configlib/config.py`
- `tests/test_config_override.py`
- `tests/conftest.py`

Verification:

- Before the fix, `python -m pytest -q` failed with `en_US != zh_TW`.
- Before the fix, `python -m pytest -q tests/test_app_flags.py tests/test_config_override.py` failed, while the reverse order passed.
- After the fix, `python -m pytest -q` passes: `5 passed`.
- After the fix, the order permutations pass:
  - `python -m pytest -q tests/test_app_flags.py tests/test_config_override.py`
  - `python -m pytest -q tests/test_config_override.py tests/test_app_flags.py`
  - `python -m pytest -q tests/test_zz_reporting.py tests/test_config_override.py`
- After the fix, the CI env permutation also passes with `APP_RETRY_BUDGET=5`.

Remaining note: the config object is still process-wide by design. The tests now
reset explicit overrides between cases so that test order does not leak global
state.
