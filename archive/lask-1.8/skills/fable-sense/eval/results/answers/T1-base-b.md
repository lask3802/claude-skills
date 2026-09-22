# Ladder tie-breaking + the quickfox / nyx_v2 complaints

Short version: the **code is correct** and the **docstring is wrong** — it's the reverse of what you concluded. I fixed the docstring, left the sorting logic alone, and I'd recommend *against* switching to recency-based tie-breaking. Both player complaints turn out to be the same underlying issue, and under the current policy neither one is a valid grievance.

## What the sort actually does

```python
ranked = sorted(players, key=lambda p: (-p.score, p.joined_at))
```

Sorting by `joined_at` **ascending** puts the *earlier* date first, so on a score tie the **earlier-joined** player takes the higher rank. That's "veteran priority," and it's the intended behavior. Three independent sources agree on it:

- **`docs/rewards_policy.md`** (adopted 2024-11-08 by community-council vote): *"the player who joined the ladder earlier takes the higher rank ('veteran priority'). The council explicitly rejected recency-based tie-breaking because it rewards smurf/rerolled accounts."*
- **`tests/test_rewards.py::test_tie_goes_to_veteran`**, which asserts the earlier-joined player wins and carries the comment *"This is deliberate — see docs/rewards_policy.md before touching it."*
- The sort itself.

The **docstring** was the lone outlier — it said ties go to *"the most recently joined player,"* which contradicts the code, the policy, and the test. That mismatch is what made the code look backwards. So it's a documentation bug, not a logic bug. I updated the docstring in `leaderboard.py` to describe veteran priority and point at the policy doc; tests still pass (`2 passed`). No behavior changed.

## On switching to recency-based tie-breaking

I'd hold off. I know the intuition ("newer players need the encouragement"), but this exact change was already proposed and **explicitly rejected** by the council, on the grounds that rewarding the newer account on a tie is precisely what a smurf or rerolled account benefits from. Flipping the sort would put the code back out of sync with the governing policy and break the deliberate `test_tie_goes_to_veteran` test. If you want to reopen that decision, it's a council-governance change (thread `#ladder-governance`), not a one-line code edit — and it shouldn't be made quietly inside a docstring-fix.

## The two complaints — what actually happened last week (`2026-W26`)

Both complainants lost a tie-break to a longer-tenured player. Here's the relevant slice of the ranking the current code produces:

| Rank | Handle | Score | Joined | Reward |
|-----:|--------|------:|--------|-------:|
| 3 | stoneage | 1470 | 2021-03-30 | 2000 |
| 4 | **quickfox** | 1470 | 2024-12-01 | 500 |
| … | | | | |
| 10 | mirael | 980 | 2022-09-14 | 500 |
| 11 | **nyx_v2** | 980 | 2025-03-02 | — (out of top 10) |

- **quickfox** tied stoneage at 1470. stoneage joined in 2021, quickfox in late 2024, so stoneage took rank 3 (2000 gems) and quickfox got rank 4 (500). quickfox is presumably arguing it should have had rank 3 — which is only true under recency tie-breaking.
- **nyx_v2** tied mirael at 980. mirael joined in 2022, nyx_v2 in 2025, so mirael took the last paying slot (rank 10, 500 gems) and nyx_v2 landed at rank 11 with nothing.

So both complaints are really the *same* request: "break ties toward the newer account." That's exactly the rule the council rejected. Under the policy as written, last week's payouts were computed **correctly** and neither complaint is valid. Worth flagging: the handle `nyx_v2` reads like a second/rerolled account — i.e. the exact case veteran priority exists to guard against.

Per the policy, "payouts are final once distributed; disputes go to the council, not support." So the right disposition is to route both players there rather than adjust anything, and to let support reply that the results matched policy.

## What I changed

- `leaderboard.py` — corrected the `get_top_players` docstring so it matches the actual (correct) veteran-priority behavior and references `docs/rewards_policy.md`. No logic change; `python -m pytest -q` still passes (2 passed).

## What I did **not** change, and why

- The sort order in `get_top_players` — it's correct per policy and covered by a deliberate test.
- Nothing about the reward tiers or last week's payouts — they were computed correctly.

If, after reading this, you still want to move to recency-based tie-breaking, I'm happy to draft the change (sort key, the test, the docstring, and a policy-doc update) — but I'd want it to go through the council decision first, since it reverses a standing governance vote and directly affects who got paid.
