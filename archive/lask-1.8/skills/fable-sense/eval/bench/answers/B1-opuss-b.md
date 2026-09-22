Done — caching is in `apiclient/client.py`, thread-safe, tests green (12 passed, `python -m pytest -q`).

## The biggest win wasn't get_rates/get_profile

Before touching those, I looked at what actually generates request volume. Every call — `get_rates`, `get_profile`, **and** `create_order` — ran `_auth_headers()`, which minted a **fresh bearer token** (`POST /v1/auth/token`) every single time. Per `docs/rate_limits.md`, the token exchange **counts against the same 1 rps/key budget**. So today **every API request is really two requests**, and the token half was pure waste (tokens live ~90s but were thrown away immediately).

Caching only `get_rates`/`get_profile` as suggested would have left that untouched — and for `get_profile`, where each user_id is usually distinct (few cache hits), the wasted token refetch is most of the cost. So the highest-leverage fix was **reusing the token for its lifetime**. Measured on two back-to-back 50-user `enrich_batch` cycles: **204 → 52 requests (75% fewer)**, and a warm second cycle costs **0** requests.

## What I changed

`apiclient/client.py` now caches, all thread-safe (worker.py shares one client across 8 threads):

| What | Behavior | Constraint it respects |
|------|----------|------------------------|
| **Auth token** | Reused until ~5s before `expires_at` (~90s life); refresh is single-flight so 8 threads mint at most one token per window | Token exchange counts against the budget |
| **`get_rates`** | Cached 30s (single-flight) | Server recomputes the table every 30s — faster polling returns identical data |
| **`get_profile`** | Cached per user_id, **240s** TTL, LRU-bounded (10k default) | Profile edits must be visible **within 5 min** — 240s leaves margin; the constructor **rejects `profile_ttl > 300`** so nobody can silently break compliance |
| **`create_order`** | **Not cached** | Explicitly **not idempotent server-side** — caching would drop real orders |

Details worth knowing:
- **Thread-safety**: token and rates refreshes hold a lock across the network call (single-flight → no thundering herd against the 1 rps budget). Profiles fetch outside the lock keyed by user_id, so distinct users still resolve in parallel across the worker threads.
- **Errors are never cached** — only successful responses populate the cache.
- **Memory bounded**: the profile cache is an LRU with a size cap, so the long-running ingest tier can't leak on unbounded distinct user_ids.
- **Ops controls**: TTLs / skew / cap are constructor kwargs; `invalidate_profile(user_id)` and `clear_caches()` are available. `get_auth_token()` stays uncached (raw exchange); caching lives in `_auth_headers()`.
- The public method signatures are unchanged, so `worker.py` and the order flow need no edits.

## Tests

Added `tests/test_caching.py` (existing `tests/test_client.py` untouched and still passing). It proves: token minted once across mixed calls and refreshed only after expiry; rates cached for 30s then re-fetched; profiles cached per user and expiring after TTL; the `profile_ttl > 300` guard; LRU eviction; `create_order` always hits the network with distinct order ids; and — via the real `worker.enrich_batch` on 8 threads — one token + one rates table + one fetch per distinct profile, with a repeated batch fully served from cache. Ran the suite 8x to confirm the threaded test isn't flaky.

## One thing I deliberately did NOT do

I don't invalidate a user's profile cache on `create_order`. Nothing in the docs says an order mutates the profile, and profile edits are described as support-ticket-only. If placing an order can change tier/balance in a way you read back immediately, tell me and I'll wire `create_order` to call `invalidate_profile(user_id)`.
