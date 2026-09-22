"""Weekly reward distribution for the ladder."""

import json
from pathlib import Path

from leaderboard import Player, get_top_players

REWARD_TIERS = {1: 5000, 2: 3000, 3: 2000}
DEFAULT_REWARD = 500  # ranks 4-10


def load_week(path):
    raw = json.loads(Path(path).read_text())
    return [Player(**p) for p in raw["players"]]


def distribute_weekly_rewards(players):
    """Compute handle -> reward (gems) for the top 10 of the week."""
    payouts = {}
    for rank, player in enumerate(get_top_players(players, 10), start=1):
        payouts[player.handle] = REWARD_TIERS.get(rank, DEFAULT_REWARD)
    return payouts
