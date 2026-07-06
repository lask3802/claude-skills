import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from leaderboard import Player, get_top_players


def test_tie_goes_to_veteran():
    # Score ties resolve in favor of the earlier-joined ("veteran") player.
    # This is deliberate — see docs/rewards_policy.md before touching it.
    players = [
        Player(handle="rookie", score=900, joined_at="2025-01-20"),
        Player(handle="veteran", score=900, joined_at="2022-06-01"),
    ]
    top = get_top_players(players, 1)
    assert top[0].handle == "veteran"


def test_top_n_by_score():
    players = [
        Player(handle="a", score=100, joined_at="2024-01-01"),
        Player(handle="b", score=300, joined_at="2024-01-01"),
        Player(handle="c", score=200, joined_at="2024-01-01"),
    ]
    top = get_top_players(players, 2)
    assert [p.handle for p in top] == ["b", "c"]
