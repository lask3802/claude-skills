"""Enrich stage: annotate events with region metadata."""


def enrich(events, region):
    for ev in events:
        ev["region"] = region
        yield ev
