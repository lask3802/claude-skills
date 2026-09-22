"""Leaderboard queries for the weekly ladder."""

from dataclasses import dataclass


@dataclass(frozen=True)
class Player:
    handle: str
    score: int
    joined_at: str  # ISO date, e.g. "2023-04-11"


def get_top_players(players, n):
    """Return the top *n* players for reward distribution.

    Players are ranked by score (highest first). Ties are broken in
    favor of the most recently joined player.
    """
    ranked = sorted(players, key=lambda p: (-p.score, p.joined_at))
    return ranked[:n]
