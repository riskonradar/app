from __future__ import annotations

import argparse
import json
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from paper_classifier.corpus import iter_corpus_papers
from paper_classifier.easa_importer import import_easa_ads
from paper_classifier.extractor import CLASSIFIER_VERSION as KEYWORD_CLASSIFIER_VERSION
from paper_classifier.extractor import classify_paper
from paper_classifier.fmea_ris_classifier import classify_ris
from paper_classifier.fmea_supabase_exporter import export_fmea_from_supabase
from paper_classifier.llm import (
    LLM_CLASSIFIER_VERSION,
    LlmConfig,
    LlmExtractorError,
    extract_with_llm,
    load_llm_config,
)
from paper_classifier.repository import CandidatePaper, PostgresRepository, paper_from_candidate


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Classify candidate papers into reliability knowledge."
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    prototype_parser = subparsers.add_parser(
        "prototype-ris",
        help="Regenerate the prototype FMEA JSON from a RIS export.",
    )
    prototype_parser.add_argument("--ris", type=Path, required=True)
    prototype_parser.add_argument("--output", type=Path, required=True)

    supabase_fmea_parser = subparsers.add_parser(
        "export-fmea-supabase",
        help="Regenerate the prototype FMEA JSON from Supabase paper and EASA evidence.",
    )
    supabase_fmea_parser.add_argument("--output", type=Path, required=True)

    import_parser = subparsers.add_parser(
        "import-corpus",
        help="Import the existing SQLite corpus into papers_raw.paper_candidates.",
    )
    import_parser.add_argument("--corpus-db", type=Path, required=True)
    import_parser.add_argument("--limit", type=int, default=None)
    import_parser.add_argument("--dry-run", action="store_true")

    easa_parser = subparsers.add_parser(
        "import-easa",
        help="Import EASA ADs from public.easa_ads into papers_raw.paper_candidates.",
    )
    easa_parser.add_argument("--limit", type=int, default=None)
    easa_parser.add_argument("--dry-run", action="store_true")

    classify_parser = subparsers.add_parser(
        "classify",
        help="Classify pending paper candidates into atomic evidence claims.",
    )
    classify_parser.add_argument(
        "--limit", type=int, default=25,
        help="Maximum number of pending paper candidates to classify.",
    )
    classify_parser.add_argument(
        "--mode", choices=("backfill", "incremental"), default="incremental",
    )
    classify_parser.add_argument("--classifier-version", default=None)
    classify_parser.add_argument(
        "--extractor", choices=("auto", "llm", "keyword"), default="auto",
        help="auto uses LLM when LLM_PROVIDER is configured, otherwise keyword.",
    )
    classify_parser.add_argument("--dry-run", action="store_true")
    classify_parser.add_argument("--watch", action="store_true")
    classify_parser.add_argument("--interval-seconds", type=int, default=60)
    classify_parser.add_argument(
        "--workers", type=int, default=4,
        help="Parallel API workers. Default 4. Increase for faster throughput.",
    )
    classify_parser.add_argument(
        "--topic", type=str, default=None,
        help="Filter papers by topic keyword in title or abstract (e.g., 'turbofan').",
    )

    link_parser = subparsers.add_parser(
        "link-taxonomy",
        help="Link supported evidence claims to taxonomy nodes (exact -> alias -> fuzzy). Incremental; safe to re-run.",
    )
    link_parser.add_argument("--dry-run", action="store_true")

    args = parser.parse_args()

    if args.command == "prototype-ris":
        _classify_prototype_ris(args.ris, args.output)
    elif args.command == "export-fmea-supabase":
        _export_fmea_supabase(args.output)
    elif args.command == "import-corpus":
        _import_corpus(args.corpus_db, args.limit, args.dry_run)
    elif args.command == "import-easa":
        count = import_easa_ads(limit=args.limit, dry_run=args.dry_run)
        action = "Would import" if args.dry_run else "Imported"
        print(f"{action} {count} EASA ADs.")
    elif args.command == "link-taxonomy":
        with PostgresRepository() as repository:
            counts = repository.link_taxonomy(dry_run=args.dry_run)
        action = "Would link" if args.dry_run else "Linked"
        print(f"{action} taxonomy claims: {_taxonomy_link_summary(counts)}.")
    elif args.command == "classify":
        _classify_pending(
            args.limit,
            args.mode,
            args.classifier_version,
            args.extractor,
            args.dry_run,
            args.watch,
            args.interval_seconds,
            args.workers,
            args.topic,
        )


def _classify_prototype_ris(ris: Path, output: Path) -> None:
    payload = classify_ris(ris)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"paper-classifier wrote {payload['rowCount']} FMEA rows to {output}")


def _export_fmea_supabase(output: Path) -> None:
    payload = export_fmea_from_supabase()
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"paper-classifier wrote {payload['rowCount']} Supabase FMEA rows to {output}")


def _import_corpus(corpus_db: Path, limit: int | None, dry_run: bool) -> None:
    if not corpus_db.exists():
        raise SystemExit(f"Corpus database does not exist: {corpus_db}")
    if dry_run:
        count = sum(1 for _ in iter_corpus_papers(corpus_db, limit))
    else:
        with PostgresRepository() as repository:
            count = repository.upsert_corpus_papers(iter_corpus_papers(corpus_db, limit))
    print(f"{'Read' if dry_run else 'Imported'} {count} corpus papers.")


def _classify_pending(
    limit: int,
    mode: str,
    classifier_version: str | None,
    extractor: str,
    dry_run: bool,
    watch: bool,
    interval_seconds: int,
    workers: int,
    topic_filter: str | None,
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
        count = _classify_batch(limit, mode, effective_version, extractor, llm_config, dry_run, workers, topic_filter)
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
    workers: int,
    topic_filter: str | None,
) -> int:
    with PostgresRepository() as repository:
        candidates = repository.pending_candidates(limit, classifier_version, topic_filter)

    if not candidates:
        return 0

    def process(candidate: CandidatePaper) -> int:
        paper = paper_from_candidate(candidate)
        if not (paper.abstract and paper.abstract.strip()):
            if not dry_run:
                with PostgresRepository() as repo:
                    repo.mark_skipped(candidate, classifier_version, mode, "no abstract available")
            print(f"{candidate.id}: skipped (no abstract)")
            return 0
        if llm_config is not None:
            try:
                result = extract_with_llm(paper, llm_config)
            except LlmExtractorError as error:
                if extractor == "llm":
                    raise
                print(f"{candidate.id}: LLM failed, falling back to keyword: {error}")
                result = classify_paper(paper)
        else:
            result = classify_paper(paper)

        with PostgresRepository() as repo:
            repo.save_classification(candidate, result, classifier_version, mode, dry_run)

        claims_returned = result.metadata.get("claims_returned")
        relationships_returned = result.metadata.get("relationships_returned")
        counters = (
            f"claims={len(result.claims)}/{claims_returned} relationships={len(result.relationships)}/{relationships_returned}"
            if claims_returned is not None
            else f"claims={len(result.claims)} relationships={len(result.relationships)}"
        )
        print(f"{candidate.id}: {result.relevance} {counters}")
        return 1

    count = 0
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {pool.submit(process, c): c for c in candidates}
        for future in as_completed(futures):
            candidate = futures[future]
            try:
                count += future.result()
            except Exception as exc:
                print(f"{candidate.id}: failed: {exc}")
                if not dry_run:
                    try:
                        with PostgresRepository() as repo:
                            repo.record_failure(candidate, classifier_version, mode, str(exc))
                    except Exception as db_exc:
                        print(f"{candidate.id}: could not persist failure: {db_exc}")

    if count and not dry_run:
        try:
            with PostgresRepository() as repository:
                linked = repository.link_taxonomy()
            print(f"Taxonomy linking: {_taxonomy_link_summary(linked)}.")
        except Exception as exc:
            # unlinked claims stay in the taxonomy inbox; never fail the batch
            print(f"Taxonomy linking skipped: {exc}")
    return count


def _taxonomy_link_summary(counts: dict[str, int]) -> str:
    return ", ".join(
        f"{count} {label.replace('_', '-')} claim(s)" for label, count in counts.items()
    )


if __name__ == "__main__":
    main()
