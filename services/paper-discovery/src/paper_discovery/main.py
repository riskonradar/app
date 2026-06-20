from __future__ import annotations

import argparse


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Discover candidate engineering failure papers."
    )
    parser.add_argument(
        "--keyword",
        action="append",
        default=[],
        help="Keyword to search for. Can be provided multiple times.",
    )
    args = parser.parse_args()

    keywords = args.keyword or ["failure analysis", "reliability", "FMEA"]
    print("paper-discovery scaffold")
    print("keywords:", ", ".join(keywords))


if __name__ == "__main__":
    main()
