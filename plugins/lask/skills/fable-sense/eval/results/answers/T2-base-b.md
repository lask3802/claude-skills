# Dedupe stage — implemented

I implemented `dedupe(events)` in `pipeline/dedupe.py` as a streaming generator that drops
duplicate re-sends while preserving genuinely distinct events, and added
`pipeline/test_dedupe.py` (6 tests, all passing) covering the sample capture plus the edge
cases. The full chain still composes: `enrich(dedupe(gateway_events), region=...)`.

## What the capture actually told me (and why the obvious approach is wrong)

I looked at `data/events_sample.jsonl` before writing anything, because the right dedup key
depends entirely on what a "duplicate" looks like here. Of the 14 events, four `event_id`s
repeat — but they are two different things:

| event_id | occurrences | what it is |
|---|---|---|
| `ev-7f02`, `ev-7f04`, `ev-7f01` | attempt 1 then attempt 2/3, **identical payload** | true client retries → must drop |
| `ev-7f08` | **both attempt 1**, 1s apart, payload `home` vs `shop` | an **id collision** — two different events → must keep both |

So the tempting one-liner — `seen = set(); dedupe on event_id` — is wrong twice over:

1. **It corrupts data.** It would drop one of the two `ev-7f08` events. They aren't retries
   (both are attempt 1, different payloads); they're distinct events that happen to share an
   id. Losing one is a silent data-loss bug that a naive implementation passing a "looks
   deduped" eyeball test would ship.
2. **It leaks memory.** The README says one worker runs *for weeks* under a **128 MB ceiling**
   at ~2k events/sec. A `set()` that remembers every id forever grows without bound and
   eventually OOM-kills the worker.

## The design

- **Identity = content, not id.** The dedup key is the event with the volatile delivery
  fields (`attempt`, `sent_at`) stripped, canonicalized (sorted keys, so payload key-order
  doesn't matter), and hashed to a 128-bit digest. Retries collapse (same content); id
  collisions survive (different payload). Both `attempt` and `sent_at` are exactly the fields
  that change across a re-send, and nothing else does — I verified this against the capture.

- **Bounded memory via the redelivery window.** `config/gateway.yaml` gives
  `redelivery_window_minutes: 10`, and clients retry within that window too. So a key only has
  to be remembered for ~10 minutes; keys older than `window_seconds` (default 600) are evicted
  and their memory reclaimed. This turns an unbounded set into a window-sized one. Eviction is
  O(1) amortized (insertion order == expiry order, so the oldest key is always at the front).

- **Streaming generator**, matching `enrich.py`'s idiom — lazy, order-preserving, first
  occurrence wins, O(window) memory rather than O(stream).

- **Robust to disorder and clock skew.** The stream isn't strictly time-ordered (e.g.
  `ev-7f05`/`ev-7f06` arrive out of order) and `sent_at` is unreliable client time. Eviction
  therefore uses the worker's own monotonic receive clock, not event timestamps — a skewed
  client clock can't cause a premature eviction (dedup miss) or unbounded retention. One bad
  or non-dict event won't crash the worker either.

## The honest part: memory at full load

I measured the real cost: ~164 bytes per tracked key in CPython. That means:

- The default hard cap `max_keys=500_000` is **~82 MB** — deliberately under the 128 MB
  ceiling with headroom. It's a burst safety valve: under extreme all-unique load the worker
  drops a few duplicates rather than OOM-crashing the whole stream.
- But **exact** dedup over the *full* 10-minute window at a sustained 2k *unique* events/sec is
  ~1.2M keys ≈ **~196 MB** — which does **not** fit in 128 MB. Real traffic has far fewer
  unique keys in-window (most of the 2k/sec are not retries), so this is a worst case, not the
  normal case. If a deployment genuinely hits it, the exact-set approach is the wrong tool and
  I'd swap the backing store for a **rotating/partitioned Bloom filter** (bounded, sublinear
  memory, tiny false-positive rate) or an **external TTL store** (Redis with per-key expiry).
  This is documented in the module's MEMORY note so whoever tunes it isn't surprised.

I chose to ship the exact windowed implementation (correct and clear for the normal load)
plus the documented cap and upgrade path, rather than pre-emptively build a Bloom filter that
most regions won't need.

## Tunables

`dedupe(events, *, window_seconds=600, max_keys=500_000, volatile_fields={"attempt","sent_at"},
key=None, now=time.monotonic)`. Defaults come straight from `gateway.yaml`; `window_seconds`
should stay ≥ the redelivery window, and `now` is injectable for tests or for offline replay
(where you'd feed an event-time clock instead of wall time).

## Verification

- `python pipeline/test_dedupe.py` → **6/6 pass**. Cases: sample capture (14 in → 11 out; the
  three retries dropped, both `ev-7f08` kept), payload-key-reorder retry, id collision, window
  eviction of a late repeat, `max_keys` bound, and non-dict robustness.
- Full pipeline `enrich(dedupe(events), region="ap-1")` yields the 11 expected enriched events.

## Files

- `pipeline/dedupe.py` — implementation (stdlib only: `json`, `hashlib`, `time`, `collections`).
- `pipeline/test_dedupe.py` — tests.

## One thing to confirm with ops

I treat `attempt` and `sent_at` as the only volatile fields. If the gateway ever adds another
field that legitimately varies across a redelivery (a receive timestamp, a routing hop count,
etc.), add it to `volatile_fields` — otherwise redeliveries carrying that field would look
distinct and slip through. It's a one-line config change, called out so it's a conscious
decision rather than a latent bug.
