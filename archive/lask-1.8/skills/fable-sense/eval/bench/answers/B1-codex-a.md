Implemented production-ready caching in `apiclient/`.

What changed:
- Added thread-safe TTL caching for `get_rates()` with a 30-second default TTL.
- Added bounded per-user TTL caching for `get_profile()` with a 5-minute default TTL.
- Added auth-token caching until 5 seconds before `expires_at`, since token exchange also counts against the partner rate limit.
- Collapsed concurrent in-flight cache fills for the same rates/profile key so shared clients do not stampede the partner API.
- Kept `create_order()` uncached because it is non-idempotent, while still allowing it to reuse cached auth tokens.
- Added explicit `invalidate_rates()`, `invalidate_profile(user_id)`, and `clear_cache()` hooks.
- Documented the cache behavior in `docs/rate_limits.md`.

Verification:
- `python -m pytest -q`
- Result: `13 passed in 0.15s`
