Implemented production-ready caching in `apiclient/`.

What changed:
- Added `CacheConfig` and a bounded, per-client TTL cache in `apiclient/client.py`.
- Cached `get_rates()` for 30 seconds, matching the partner recompute window.
- Cached `get_profile(user_id)` for 5 minutes, keyed per user and capped with LRU eviction.
- Cached auth tokens until `expires_at` minus a 5-second safety margin, so cached reads do not still burn token-exchange quota.
- Kept `create_order()` uncached because it is non-idempotent.
- Made cache access thread-safe with per-key single-flight loading to avoid stampedes when one `ApiClient` is shared across worker threads.
- Added `clear_cache()` and `cache_info()` for operations/debugging, and exported `CacheConfig` from `apiclient`.
- Documented cache behavior in `docs/rate_limits.md`.

Verification:
- `python -m pytest -q` passes: `11 passed in 0.08s`.

Residual note:
- I attempted the optional adversarial Claude review pass for cache-safety issues, but the local Claude call failed with `API Error: Unable to connect to API (ConnectionRefused)`, so that was not counted as verification.
