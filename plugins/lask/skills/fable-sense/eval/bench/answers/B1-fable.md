# Caching added to the API client

Caching is in place for the three read paths, sized to the constraints in
`docs/rate_limits.md`, and the full suite passes: **16 passed** with
`python -m pytest -q`.

## The biggest win wasn't get_rates or get_profile — it was the token

Before this change, every `get_rates` / `get_profile` / `create_order` call
did a **fresh `/v1/auth/token` exchange** via `_auth_headers()`, and the docs
say the token exchange counts against the same 1 rps budget. So every read
cost two requests. Tokens live ~90s; now one token serves everything for
~80s. That alone halves request volume before response caching even kicks in.

## What each endpoint got, and why those numbers

- **Auth token** — reused until 10s before `expires_at` (refresh margin
  `TOKEN_REFRESH_MARGIN`). Refresh is coalesced under a lock, so 8 worker
  threads waking up at once still produce one exchange.
- **`/v1/rates`** — cached 30s (`RATES_TTL`), matching the server's recompute
  interval; the docs say polling faster returns identical data, so this
  drops redundant polls with zero data loss.
- **`/v1/profiles/{id}`** — cached per user for 240s (`PROFILE_TTL`).
  Compliance requires profile changes visible within 5 minutes; 240s leaves
  a minute of margin. A test (`test_profile_ttl_within_compliance_bound`)
  pins the TTL under 300s so nobody bumps it past the bound later. There's
  also `invalidate_profile(user_id)` for when our own tooling edits a
  profile and needs immediate visibility.
- **`create_order`** — deliberately **never cached** (not idempotent
  server-side); a test asserts two identical orders produce two POSTs.

## Production-readiness details

- **Thread safety**: `worker.py` shares one client across 8 threads, so the
  cache (`apiclient/cache.py`) is lock-protected, and concurrent misses on
  the same key **coalesce into a single upstream request** (verified by a
  multi-threaded test with a barrier).
- **Bounded memory**: the profile cache is LRU-bounded (default 4096
  entries) so unbounded user-id streams in the ingest tier can't grow it
  forever.
- **Errors are never cached**: a failed fetch stores nothing; the next
  caller retries.
- **Cache-poisoning protection**: cached responses are deep-copied on
  return, so a caller mutating its result can't corrupt what other callers
  (or other worker rows) see.
- **401 recovery**: the partner "rotates signing keys aggressively", so a
  cached token can die before `expires_at`. Authorized requests now catch a
  401 once, drop the cached token, and retry with a fresh one. (401 means
  the request was rejected pre-processing, so this is safe even for
  `create_order`.)
- **Configurable / escapable**: `ApiClient(..., rates_ttl=, profile_ttl=,
  profile_cache_size=)`; a TTL of 0 disables that cache. The clock is
  injectable, which is also how the TTL tests stay deterministic.
- **API compatibility**: constructor and public methods are unchanged;
  `worker.py` and existing callers need no edits. `get_auth_token()` now
  returns the cached token while valid — its docstring documents this.

## Expected impact

For a worker batch of N users the client previously issued `2N + 2`
requests (token + call each time). Now, steady-state over 4 minutes:
~3 token exchanges + 8 rates fetches + 1 fetch per distinct user —
independent of how often upstream services call us.

## Files changed

- `apiclient/cache.py` — new: thread-safe, LRU-bounded TTL cache with
  per-key fetch coalescing
- `apiclient/client.py` — token reuse, rates/profile caching, 401
  retry-once, invalidation hooks
- `tests/fake_transport.py` — accepts an injectable clock (was silently
  using wall time)
- `tests/test_client.py` — 14 new tests: TTL expiry, per-user keying,
  token reuse/refresh, compliance-bound pin, no-cache-on-orders, LRU
  eviction, mutation safety, 401 recovery, thread coalescing
- `README.md` — caching section

## One thing worth a follow-up (not changed)

`_request_with_retry` retries 503s for **all** requests, including
`create_order`, which the code itself flags as not idempotent. If the
partner ever processes a request before shedding it with a 503, retries
could duplicate orders. That behavior predates this change and other
callers may rely on it, so I left it alone — but it's worth confirming
with the partner whether a 503 guarantees non-processing, or adding an
idempotency key to orders if they support one.
