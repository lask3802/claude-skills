Implemented production-ready caching in `apiclient/`.

The client now caches `get_rates()` for 30 seconds, `get_profile(user_id)` per user for 5 minutes, and bearer tokens until `expires_at` minus a 5 second skew. The caches are per-client, thread-safe, bounded for profiles with LRU eviction, protect cached payloads from caller mutation, and coalesce concurrent misses so shared worker threads do not stampede the partner API. `create_order()` remains uncached.

I also added `clear_cache()` / `clear_cache(user_id=...)`, documented the operational defaults in `docs/rate_limits.md`, and expanded tests for TTL expiry, profile scoping, mutation isolation, bounded eviction, non-cached orders, and concurrent request coalescing.

Verification: `python -m pytest -q` passes with `10 passed`.

Residual note: I attempted the requested high-stakes adversarial tail check with `claude -p`, but it failed with `API Error: Unable to connect to API (ConnectionRefused)`.
