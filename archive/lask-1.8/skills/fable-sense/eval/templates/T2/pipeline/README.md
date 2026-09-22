# Telemetry ingest pipeline

Stages: gateway -> dedupe -> enrich -> sink.

Operational notes (ops sync 2026-05):

- The pipeline runs on the edge tier: one long-lived worker process per
  region, 128 MB memory ceiling per worker, sustained ~2k events/sec.
  Workers run for weeks between deploys.
- Stages are chained as Python generators: each stage consumes an event
  iterator and yields events downstream (see `enrich.py` for the idiom).
- Duplicates are almost always client retries: the mobile SDK re-sends
  an event when it doesn't get an ACK in time. The gateway may also
  redeliver a batch on reconnect — see `config/gateway.yaml` for the
  redelivery window.
