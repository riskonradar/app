from __future__ import annotations

import argparse
from pathlib import Path

from paper_classifier.fmea_ris_classifier import classify_ris


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
    parser.add_argument(
        "--ris",
        type=Path,
        help="Prototype RIS export to classify into FMEA knowledge rows.",
    )
    parser.add_argument(
        "--output",
        type=Path,
        help="Where to write classified FMEA JSON.",
    )
    args = parser.parse_args()

    if args.ris and args.output:
        payload = classify_ris(args.ris)
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(
            __import__("json").dumps(payload, indent=2, ensure_ascii=False),
            encoding="utf-8",
        )
        print(f"paper-classifier wrote {payload['rowCount']} FMEA rows to {args.output}")
        return

    print("paper-classifier scaffold")
    print("limit:", args.limit)


if __name__ == "__main__":
    main()
