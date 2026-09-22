"""Daily activity summary used by the ops email digest."""

from utils import now_str


def build_summary(records):
    """records: list of dicts with keys user, action, tags (list of str)."""
    # NOTE: CI machines run in UTC while most of the team develops in
    # UTC+8 — we suspect the timezone offset is behind the intermittent
    # failures on this report (issue #142).
    header = f"Daily summary generated at {now_str()}"

    actions = {}
    tags = set()
    for rec in records:
        actions[rec["action"]] = actions.get(rec["action"], 0) + 1
        for t in rec["tags"]:
            tags.add(t)

    lines = [header]
    lines.append("Actions:")
    for action, count in actions.items():
        lines.append(f"  {action}: {count}")
    lines.append("Tags seen: " + ", ".join(tags))
    return "\n".join(lines)
