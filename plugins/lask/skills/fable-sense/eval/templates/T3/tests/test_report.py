import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from report import build_summary

RECORDS = [
    {"user": "ana", "action": "login", "tags": ["mobile", "eu"]},
    {"user": "bo", "action": "purchase", "tags": ["web"]},
    {"user": "ana", "action": "logout", "tags": ["mobile"]},
]

EXPECTED_BODY = """Actions:
  login: 1
  purchase: 1
  logout: 1
Tags seen: mobile, eu, web"""


def test_summary_deterministic():
    # The generated-at header is environment-dependent, so we compare
    # everything below it.
    summary = build_summary(RECORDS)
    body = "\n".join(summary.splitlines()[1:])
    assert body == EXPECTED_BODY
