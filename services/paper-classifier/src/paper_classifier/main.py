from __future__ import annotations

import argparse
import time
from pathlib import Path

from paper_classifier.corpus import iter_corpus_papers
from paper_classifier.extractor import CLASSIFIER_VERSION as KEYWORD_CLASSIFIER_VERSION
from paper_classifier.extractor import classify_paper
from paper_classifier.llm import LLM_CLASSIFIER_VERSION, LlmConfig, LlmExtractorError, extract_with_llm, load_llm_config
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
        default=None,
        help="Version label stored with classification jobs.",
    )
    classify_parser.add_argument(
        "--extractor",
        choices=("auto", "llm", "keyword"),
        default="auto",
        help="Extractor to use. auto uses LLM when LLM_PROVIDER is configured, otherwise keyword.",
    )
    classify_parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Classify and print a summary without writing to Postgres.",
    )
    classify_parser.add_argument(
        "--watch",
        action="store_true",
        help="Continuously poll Supabase for newly eligible papers.",
    )
    classify_parser.add_argument(
        "--interval-seconds",
        type=int,
        default=60,
        help="Polling interval for --watch.",
    )
    args = parser.parse_args()

    if args.command == "import-corpus":
        _import_corpus(args.corpus_db, args.limit, args.dry_run)
    elif args.command == "classify":
        _classify_pending(
            args.limit,
            args.mode,
            args.classifier_version,
            args.extractor,
            args.dry_run,
            args.watch,
            args.interval_seconds,
        )


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


def _classify_pending(
    limit: int,
    mode: str,
    classifier_version: str | None,
    extractor: str,
    dry_run: bool,
    watch: bool,
    interval_seconds: int,
) -> None:
    llm_config = None
    if extractor in {"auto", "llm"}:
        llm_config = load_llm_config()
        if extractor == "llm" and llm_config is None:
            raise SystemExit("Set LLM_PROVIDER and provider API key, or use --extractor keyword.")

    effective_version = classifier_version or (
        f"{LLM_CLASSIFIER_VERSION}:{llm_config.provider}:{llm_config.model}"
        if llm_config is not None
        else KEYWORD_CLASSIFIER_VERSION
    )

    while True:
        count = _classify_batch(limit, mode, effective_version, extractor, llm_config, dry_run)
        print(f"Classified {count} pending papers.")
        if not watch:
            break
        time.sleep(max(interval_seconds, 1))


def _classify_batch(
    limit: int,
    mode: str,
    classifier_version: str,
    extractor: str,
    llm_config: LlmConfig | None,
    dry_run: bool,
) -> int:
    with PostgresRepository() as repository:
        candidates = repository.pending_candidates(limit, classifier_version)
        for candidate in candidates:
            paper = paper_from_candidate(candidate)
            if llm_config is not None:
                try:
                    result = extract_with_llm(paper, llm_config)
                except LlmExtractorError as error:
                    if extractor == "llm":
                        raise
                    print(f"{candidate.id}: LLM failed, falling back to keyword extractor: {error}")
                    result = classify_paper(paper)
            else:
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
        return len(candidates)


if __name__ == "__main__":
    main()
