I found a documentation bug, not a reward-calculation bug.

`get_top_players` was already sorting ties by `joined_at` ascending, which means the earlier-joined player wins the tie. That matches `docs/rewards_policy.md`, which says the ladder uses veteran priority and explicitly rejected recency-based tie-breaking. The docstring in `leaderboard.py` was backwards, so I corrected it.

For the supplied `data/last_week.json` data:

- `quickfox` tied `stoneage` at 1470. `stoneage` joined on 2021-03-30; `quickfox` joined on 2024-12-01. Under veteran priority, `stoneage` is rank 3 and gets 2000 gems, while `quickfox` is rank 4 and gets 500 gems.
- `nyx_v2` tied `mirael` at 980. `mirael` joined on 2022-09-14; `nyx_v2` joined on 2025-03-02. Under veteran priority, `mirael` is rank 10 and gets 500 gems, while `nyx_v2` is rank 11 and gets no weekly reward.

So the player complaints line up with the misleading docstring/support expectation, but the computed payouts are correct under the published policy. I also added a regression test covering these exact last-week tie outcomes so the tier-3 tie and rank-10 cutoff stay explicit.

Verification: `python -m pytest -q` passes with `3 passed`.

One date caveat: the file is labelled `2026-W26`. If support meant the ISO week immediately before July 6, 2026, that would be `2026-W27`; I treated `data/last_week.json` as the authoritative support-supplied dataset for this investigation.
