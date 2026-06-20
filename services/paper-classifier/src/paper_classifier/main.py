from __future__ import annotations

import argparse


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Classify candidate papers into reliability knowledge."
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=25,
        help="Maximum number of candidate papers to classify.",
    )
    args = parser.parse_args()

    print("paper-classifier scaffold")
    print("limit:", args.limit)


if __name__ == "__main__":
    main()
