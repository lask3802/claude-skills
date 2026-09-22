# Caching added to the partner API client

Done. `ApiClient` now caches its read-only calls, which cuts request volume
sharply and stays within the partner's **1 rps per key** budget. All tests pass
(`python -m pytest -q` → 23 passed).

## The measured result

Simulating the `worker.py` ingest pattern (8 users enriched over 3 polling
cycles):

| | Total upstream requests | `/v1/auth/token` |
|---|---|---|
| Before (uncached) | 54 | 27 |
| After (cached) | **10** | **1** |

That's an ~81% reduction, and within a single warm TTL window the 2nd and 3rd
cycles cost **zero** upstream requests.

## What I found (and why the fix is bigger than it looks)

The obvious targets were `get_rates` and `get_profile`, but the largest hidden
cost was `get_auth_token`. Every read *and* write first calls `_auth_headers()`
→ `get_auth_token()`, which is a separate `POST /v1/auth/token` that counts
against the *same* budget. So each logical read was really two requests. Caching
the token (it lives ~90s) alone roughly halves volume — that's the 27→1 column
above.

## What I changed

- **`apiclient/cache.py` (new)** — a small thread-safe `TtlCache`.
- **`apiclient/client.py`** — wired the cache into `get_auth_token`,
  `get_rates`, and `get_profile`. `create_order` is deliberately left uncached.
- **`apiclient/__init__.py`** — exports `ApiClient`, `TransportError`, `TtlCache`.
- **`tests/test_client.py`, `tests/test_cache.py`** — added coverage (the two
  original tests are preserved and still pass).
- **`docs/rate_limits.md`, `README.md`** — documented the TTLs and rationale.

## TTLs, tied to your operational notes

| Call | TTL | Rationale |
|---|---|---|
| auth token | until ~10s before `expires_at` | ~90s life; refresh margin so no request carries a token that dies mid-flight |
| `get_rates` | 30s (`rates_ttl`) | server recomputes every 30s; faster polling returns identical data |
| `get_profile` | 300s (`profile_ttl`) | your 5-minute compliance ceiling for a profile change to become visible |
| `create_order` | never cached | mutation, not idempotent server-side |

## Production-readiness decisions

`worker.py` says 8 worker threads share one `ApiClient`, so the cache is built
for that:

- **Thread-safe** with striped re-entrant locks (bounded lock memory even with
  one cache key per user id). Re-entrant because a cached read can trigger a
  nested cached load — `get_rates` needs the token.
- **Single-flight**: 8 threads missing the same key on a cold cache trigger
  exactly one upstream request, not 8. This is what stops the worker pool from
  stampeding the partner at startup and blowing the 1-rps budget. (Covered by
  two concurrency tests.)
- **Only successful responses are cached** — errors, including exhausted 503
  retries, propagate and are never stored.
- **Defensive copies** on every hit, so one thread mutating a result can't
  corrupt state shared with the other seven.
- **Bounded memory** — `max_entries` cap with expiry-based eviction, so a
  long-running ingest process with many distinct users won't grow without limit.
- **Operability** — `invalidate_profile(user_id)`, `invalidate_rates()`,
  `clear_cache()`, and `cache_enabled=False` for a clean rollback switch. TTLs
  are constructor args (`rates_ttl`, `profile_ttl`).

## One thing to confirm

The profile TTL defaults to **300s = exactly your 5-minute compliance ceiling**,
which maximizes the request savings but leaves no headroom for clock skew or
processing lag. If you want a safety margin, lower it, e.g.:

```python
ApiClient(transport, api_key, profile_ttl=240)  # 4 min, leaves 1 min of slack
```

No API signatures changed, so this is a drop-in upgrade for the ingest tier and
the order flow.
