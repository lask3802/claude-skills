# Caching added to the partner API client

I added a thread-safe caching layer to `apiclient/` so the upstream services stop
re-fetching the same data (and re-minting the same auth token) on every call.
All 14 tests pass (`python -m pytest -q`).

## The biggest win was hidden: the auth token

Before touching `get_rates`/`get_profile`, note what every call actually cost.
Each business call ran `_auth_headers()` → `get_auth_token()` → a **fresh**
`POST /v1/auth/token`, so every request to the partner was really *two* requests
against the same 1 rps/key budget. The token already carries an `expires_at`
(~90s) and `docs/rate_limits.md` says the token exchange counts against the
budget — so caching it is both safe and roughly halves volume on its own.

Measured against the real `worker.enrich_batch` (8 users):

| | requests to partner |
|---|---|
| Before (per batch, every batch) | **18** — 8×(token+profile) + (token+rates) |
| After, cold batch | **10** — 1 token + 8 profiles + 1 rates |
| After, warm batch (within TTLs) | **0** |

## What I cached, and why those TTLs

I matched every TTL to a documented freshness rule in `docs/rate_limits.md`
rather than picking round numbers:

- **Auth token** — reused until 5s before `expires_at` (the margin absorbs clock
  skew and in-flight latency). This is shared across all endpoints.
- **`/v1/rates` — 30s.** The server recomputes on a 30s cadence; polling faster
  returns identical data, so 30s is the exact point of zero staleness cost.
- **`/v1/profiles/{id}` — 240s, bounded LRU (1024 entries).** Compliance requires
  a profile edit be visible within 5 minutes; 240s leaves margin under that SLA.
  The LRU bound matters because profiles are keyed by user id — an unbounded dict
  would be a slow memory leak in a long-running ingest process.
- **`create_order` — never cached.** It's a non-idempotent write.

## Production-readiness details

- **Thread-safe + single-flight.** `worker.py` shares one client across 8
  threads. Without care, a cold cache hit by 8 threads becomes 8 identical
  upstream requests. The cache runs each key's fetch under a per-key lock, so a
  cold fan-out collapses to **one** request per key (verified by
  `test_concurrent_fanout_mints_one_token`, which mirrors `enrich_batch`).
  Different keys never block each other, and no network call runs while a shared
  lock is held.
- **Stale-token recovery.** Caching a token introduces a new failure mode: it can
  expire between the cache check and the server receiving the request. If the
  partner returns 401, the client drops the cached token, mints a fresh one, and
  retries once. This is safe even for `create_order` because a 401 is returned
  before the request is processed.
- **Bounded memory** via the LRU cap on profiles.
- **Operable.** `invalidate_profile(user_id)` forces an immediate re-fetch ahead
  of the TTL (e.g. after a support edit that can't wait); `clear_caches()` drops
  everything; `cache_enabled=False` is an escape hatch; and TTLs/margins/size are
  constructor kwargs.
- **Drop-in.** `worker.py` and existing call sites are unchanged — caching is
  transparent. The existing 503 retry behavior is preserved.

## Files

- `apiclient/cache.py` — new. `TTLCache`: thread-safe, single-flight
  (`get_or_compute`), bounded LRU, injectable clock.
- `apiclient/client.py` — token/rates/profile caching wired in; `_authed_request`
  helper centralizes auth + 401 retry; new config kwargs and
  `invalidate_profile` / `clear_caches`.
- `apiclient/__init__.py` — exports `ApiClient`, `TransportError`.
- `tests/fake_transport.py` — made thread-safe; added `clock` and `token_delay`
  hooks and `count()` helpers for deterministic TTL and concurrency tests.
- `tests/test_client.py` — 12 new tests (token reuse, TTL expiry/refresh,
  per-user caching, LRU eviction, invalidation, writes-not-cached, single-flight
  under concurrency, 401 re-auth, disable switch). The original 2 still pass.
- `README.md` / `docs/rate_limits.md` — documented the caching behavior and knobs.

## One judgment call to flag

I did **not** invalidate a user's cached profile after `create_order`, because
the profile holds identity/tier data that an order doesn't obviously mutate, and
`docs/rate_limits.md` doesn't require it. If placing an order can change a
profile field you read back immediately, call `invalidate_profile(user_id)` after
the order (or tell me and I'll wire it in).
