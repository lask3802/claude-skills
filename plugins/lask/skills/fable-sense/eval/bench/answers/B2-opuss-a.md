# `test_env_override_wins` failing in CI — diagnosis and fix

## TL;DR

It's not the environment variables. The test fails because of **test-ordering
pollution of a cached module global**, and it only shows up in CI because CI runs
the *whole* suite while you run that one file. I fixed it by adding an autouse
fixture (`tests/conftest.py`) that resets the config cache around every test. The
full suite is now green and order-independent. No production code changed.

## What's actually going on

`configlib/config.py` caches settings in a module-level global:

```python
_settings = None

def _load():
    merged = dict(_DEFAULTS)
    for key in _DEFAULTS:
        env_key = "APP_" + key.upper()
        if env_key in os.environ:          # env is read exactly ONCE, here
            merged[key] = os.environ[env_key]
    return merged

def get_setting(key):
    global _settings
    if _settings is None:                  # loaded on first access, then frozen
        _settings = _load()
    return _settings[key]
```

The environment is read **once**, on the first call to `get_setting()` or
`configure()`, and cached for the life of the process. It is never refreshed.

Now look at collection order. pytest collects files alphabetically:

1. `tests/test_app_flags.py::test_flags_override` → calls `configure(...)`, which
   triggers the one-and-only `_load()`. At this moment `APP_REPORT_LOCALE` is not
   set, so `report_locale` is cached as its default `en_US`.
2. `tests/test_config_override.py::test_env_override_wins` → sets
   `APP_REPORT_LOCALE=zh_TW` via `monkeypatch`, then calls `get_setting`. But the
   cache is already populated from step 1, so `_load()` never runs again and the
   env var is ignored. It returns the stale `en_US` → assertion fails.

- **Run the file alone** → `test_env_override_wins` is the first thing to touch
  the module, the cache loads *after* `monkeypatch.setenv`, env wins → passes.
- **Run the full suite** (what CI does: `python -m pytest -q`) → `test_app_flags`
  runs first and freezes the cache → `test_env_override_wins` fails.

## Why the teammate's theory doesn't hold

The teammate suspected CI's env vars (`.github/workflows/ci.yml` sets
`APP_RETRY_BUDGET: "5"`). I tested that directly and it's a red herring:

| Scenario | Result |
|---|---|
| `pytest tests/test_config_override.py` (file alone) | **pass** |
| `pytest -q` (full suite, no CI env var) | **fail** — `en_US != zh_TW` |
| `APP_RETRY_BUDGET=5 pytest -q` (full suite, simulating CI) | **fail — byte-identical** |
| `pytest tests/test_app_flags.py tests/test_config_override.py` | **fail** |
| `pytest tests/test_config_override.py tests/test_app_flags.py` | **pass** |

The full suite fails identically with and without CI's `APP_RETRY_BUDGET`, and
`APP_RETRY_BUDGET` has nothing to do with `report_locale` anyway. The real
difference between CI and your machine isn't the env — it's that **CI runs the
whole suite and you run one file**. The two green/red rows at the bottom show the
failure flipping purely on test order. (Leave the `APP_RETRY_BUDGET` line in CI as
is — it's unrelated.)

## The fix

Added `tests/conftest.py` with an autouse fixture that clears the cached global
before and after every test, so each test reads a fresh environment regardless of
order:

```python
@pytest.fixture(autouse=True)
def reset_config_cache():
    configlib.config._settings = None
    yield
    configlib.config._settings = None
```

Why this and not something else:

- **I did not make `get_setting()` re-read the env every call.** That looks
  tempting but it's wrong: `configure()` layers explicit overrides *into* the same
  cached dict, so a non-caching `get_setting` would throw those overrides away and
  break `test_flags_override` and `test_reporting_locale_switch`. The caching is
  load-bearing for the documented precedence (`configure > env > defaults`).
- **I left production code untouched.** The "load env once at startup, then cache"
  behavior is a legitimate design (the module docstring calls it "process-wide").
  The bug being exposed is that the *tests* share and pollute that global state.
  Resetting it in a fixture is the standard, contained remedy and fixes the
  fragility for any future env-based test, not just this one.
- Scoped it in `conftest.py` (not inside one test file) because the pollution is
  cross-file — `test_app_flags.py` is what poisons `test_config_override.py`.

## Verification

```
python -m pytest -q                         → 3 passed
APP_RETRY_BUDGET=5 python -m pytest -q       → 3 passed   (simulates CI)
pytest tests/test_app_flags.py tests/test_config_override.py  → 2 passed
pytest tests/test_config_override.py         → 1 passed   (file alone still green)
```

Green in every ordering I tried, including the exact CI command and the
previously-failing app-flags-first order.
