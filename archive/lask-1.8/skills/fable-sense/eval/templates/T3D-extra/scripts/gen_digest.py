"""CLI: generate the daily digest for the ops email."""

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from report import build_summary


def main():
    parser = argparse.ArgumentParser(description="Generate the daily digest.")
    parser.add_argument("records_json", help="Path to a JSON list of records")
    args = parser.parse_args()

    records = json.loads(Path(args.records_json).read_text())
    summary = build_summary(records)
    print("=== OPS DAILY DIGEST ===")
    print(summary)
    print("=== END ===")


if __name__ == "__main__":
    main()
