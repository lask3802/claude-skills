Implemented caching in `apiclient/` to reduce partner API request volume.

Changes made:
- Reused auth tokens until `expires_at - 5s` instead of exchanging a token for every call.
- Cached `get_rates()` for 30 seconds.
- Cached `get_profile(user_id)` per user for 5 minutes.
- Added thread-safe single-flight behavior so concurrent identical cache misses share one upstream request.
- Deep-copied cached responses on read/write so caller mutations cannot corrupt cache state.
- Kept `create_order()` uncached because it is not idempotent server-side.
- Added `clear_cache()` and `invalidate_profile(user_id)` hooks for operational cache control.
- Documented cache behavior in `docs/rate_limits.md`.
- Expanded tests for TTL expiry, token refresh, mutation isolation, profile invalidation, non-cached orders, and concurrent request collapse.

Verification:
- `python -m pytest -q`
- Result: `9 passed in 0.08s`
