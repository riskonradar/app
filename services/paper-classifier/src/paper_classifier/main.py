from __future__ import annotations

import argparse
from pathlib import Path

from paper_classifier.corpus import iter_corpus_papers
from paper_classifier.extractor import CLASSIFIER_VERSION, classify_paper
from paper_classifier.repository import PostgresRepository, paper_from_candidate


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Classify candidate papers into reliability knowledge."
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    import_parser = subparsers.add_parser(
        "import-corpus",
        help="Import the existing SQLite corpus into papers_raw.paper_candidates.",
    )
    import_parser.add_argument(
        "--corpus-db",
        type=Path,
        required=True,
        help="Path to riskonradar/corpus corpus.db.",
    )
    import_parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Maximum number of corpus papers to import.",
    )
    import_parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Read and count corpus records without writing to Postgres.",
    )

    classify_parser = subparsers.add_parser(
        "classify",
        help="Classify pending paper candidates into atomic evidence claims.",
    )
    classify_parser.add_argument(
        "--limit",
        type=int,
        default=25,
        help="Maximum number of pending paper candidates to classify.",
    )
    classify_parser.add_argument(
        "--mode",
        choices=("backfill", "incremental"),
        default="incremental",
        help="Classification run mode for audit metadata.",
    )
    classify_parser.add_argument(
        "--classifier-version",
        default=CLASSIFIER_VERSION,
        help="Version label stored with classification jobs.",
    )
    classify_parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Classify and print a summary without writing to Postgres.",
    )
    args = parser.parse_args()

    if args.command == "import-corpus":
        _import_corpus(args.corpus_db, args.limit, args.dry_run)
    elif args.command == "classify":
        _classify_pending(args.limit, args.mode, args.classifier_version, args.dry_run)


def _import_corpus(corpus_db: Path, limit: int | None, dry_run: bool) -> None:
    if not corpus_db.exists():
        raise SystemExit(f"Corpus database does not exist: {corpus_db}")

    if dry_run:
        count = sum(1 for _ in iter_corpus_papers(corpus_db, limit))
    else:
        papers = iter_corpus_papers(corpus_db, limit)
        with PostgresRepository() as repository:
            count = repository.upsert_corpus_papers(papers)

    action = "Read" if dry_run else "Imported"
    print(f"{action} {count} corpus papers.")


def _classify_pending(limit: int, mode: str, classifier_version: str, dry_run: bool) -> None:
    with PostgresRepository() as repository:
        candidates = repository.pending_candidates(limit)
        for candidate in candidates:
            paper = paper_from_candidate(candidate)
            result = classify_paper(paper)
            repository.save_classification(
                candidate,
                result,
                classifier_version=classifier_version,
                mode=mode,
                dry_run=dry_run,
            )
            print(
                f"{candidate.id}: {result.relevance} "
                f"claims={len(result.claims)} relationships={len(result.relationships)}"
            )
    print(f"Classified {len(candidates)} pending papers.")


if __name__ == "__main__":
    main()
