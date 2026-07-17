from __future__ import annotations

import argparse
import json
import os
import time
import urllib.error
import urllib.request
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from pathlib import Path

from paper_classifier.corpus import iter_corpus_papers
from paper_classifier.easa_importer import import_easa_ads
from paper_classifier.evaluation import (
    MODEL_CANDIDATES,
    EvaluationFormatError,
    run_model_evaluation,
    score_predictions,
    validate_annotations,
    write_annotation_template,
    write_sample,
)
from paper_classifier.extractor import CLASSIFIER_VERSION as KEYWORD_CLASSIFIER_VERSION
from paper_classifier.extractor import classify_paper
from paper_classifier.full_text import fetch_open_access_full_text
from paper_classifier.keywords import KeywordTerm
from paper_classifier.llm import (
    LLM_CLASSIFIER_VERSION,
    LlmConfig,
    LlmExtractorError,
    extract_with_llm,
    load_llm_config,
)
from paper_classifier.models import ClassificationResult, Paper
from paper_classifier.repository import CandidatePaper, PostgresRepository, paper_from_candidate
from paper_classifier.reasoning import (
    MAX_EVIDENCE_CLAIMS,
    ReasoningError,
    build_reasoning_manifest,
    execute_reasoning,
    load_reasoning_config,
)


@dataclass(frozen=True)
class BatchOutcome:
    selected: int
    succeeded: int = 0
    skipped: int = 0
    failed: int = 0
    fallbacks: int = 0
    taxonomy_failed: bool = False

    @property
    def unhealthy(self) -> bool:
        attempted = self.succeeded + self.failed
        degraded = self.failed + self.fallbacks
        return self.taxonomy_failed or (
            attempted > 0 and degraded * 2 >= attempted
        )


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Classify candidate papers into reliability knowledge."
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

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

    full_text_parser = subparsers.add_parser(
        "ingest-full-text",
        help="Fetch explicitly licensed OA PDFs, extract bounded text, and retain provenance.",
    )
    full_text_parser.add_argument("--limit", type=int, default=25)
    full_text_parser.add_argument("--dry-run", action="store_true")
    full_text_parser.add_argument(
        "--retry-failed",
        action="store_true",
        help="Retry transient failures up to three attempts; fetched/rejected URLs remain idempotent.",
    )

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

    eval_export_parser = subparsers.add_parser(
        "eval-export-sample",
        help="Export a deterministic source-interleaved evaluation sample without calling a model.",
    )
    eval_export_parser.add_argument("--output", type=Path, required=True)
    eval_export_parser.add_argument("--limit", type=int, default=50)

    eval_template_parser = subparsers.add_parser(
        "eval-annotation-template",
        help="Create an empty human-annotation JSONL file for a fixed evaluation sample.",
    )
    eval_template_parser.add_argument("--sample", type=Path, required=True)
    eval_template_parser.add_argument("--output", type=Path, required=True)

    eval_validate_parser = subparsers.add_parser(
        "eval-validate",
        help="Validate that all human annotations are complete and evidence-anchored.",
    )
    eval_validate_parser.add_argument("--sample", type=Path, required=True)
    eval_validate_parser.add_argument("--annotations", type=Path, required=True)

    eval_run_parser = subparsers.add_parser(
        "eval-run",
        help="Run one fixed model candidate over a sample using the production prompt.",
    )
    eval_run_parser.add_argument("--sample", type=Path, required=True)
    eval_run_parser.add_argument("--output", type=Path, required=True)
    eval_run_parser.add_argument("--model", choices=tuple(MODEL_CANDIDATES), required=True)

    eval_score_parser = subparsers.add_parser(
        "eval-score",
        help="Compare one or more saved model predictions against human annotations offline.",
    )
    eval_score_parser.add_argument("--sample", type=Path, required=True)
    eval_score_parser.add_argument("--annotations", type=Path, required=True)
    eval_score_parser.add_argument("--predictions", type=Path, action="append", required=True)
    eval_score_parser.add_argument("--output", type=Path, required=True)

    reasoning_parser = subparsers.add_parser(
        "reason-system",
        help="Preview or explicitly run aggregate reasoning over one tenant-accepted system graph.",
    )
    reasoning_parser.add_argument("--organization-id", required=True)
    reasoning_parser.add_argument("--asset-id", required=True)
    reasoning_parser.add_argument("--max-claims", type=int, default=200)
    reasoning_parser.add_argument(
        "--execute",
        action="store_true",
        help="Make the configured stronger-model call. Without this flag, only print the manifest hash.",
    )
    reasoning_parser.add_argument(
        "--retry-failed",
        action="store_true",
        help="Retry the same failed input at most twice; completed/running inputs remain idempotent.",
    )

    args = parser.parse_args()

    if args.command == "import-corpus":
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
    elif args.command == "ingest-full-text":
        _ingest_full_text(args.limit, args.dry_run, args.retry_failed)
    elif args.command == "eval-export-sample":
        with PostgresRepository() as repository:
            candidates = repository.evaluation_candidates(args.limit)
        count = write_sample(args.output, (paper_from_candidate(candidate) for candidate in candidates))
        print(f"Exported {count} fixed evaluation sample(s) to {args.output}.")
    elif args.command == "eval-annotation-template":
        _run_eval_command(
            lambda: write_annotation_template(args.sample, args.output),
            lambda count: f"Created {count} annotation template(s) in {args.output}.",
        )
    elif args.command == "eval-validate":
        _run_eval_command(
            lambda: validate_annotations(args.sample, args.annotations),
            lambda count: f"Validated {count} completed annotation(s).",
        )
    elif args.command == "eval-run":
        _run_eval_command(
            lambda: run_model_evaluation(args.sample, args.output, args.model),
            lambda count: f"Wrote {count} {args.model} prediction(s) to {args.output}.",
        )
    elif args.command == "eval-score":
        try:
            scores = score_predictions(args.sample, args.annotations, args.predictions)
        except EvaluationFormatError as exc:
            raise SystemExit(str(exc)) from exc
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(scores, indent=2) + "\n", encoding="utf-8")
        print(f"Wrote offline comparison to {args.output}.")
    elif args.command == "reason-system":
        _reason_system(
            args.organization_id,
            args.asset_id,
            args.max_claims,
            args.execute,
            args.retry_failed,
        )
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


def _import_corpus(corpus_db: Path, limit: int | None, dry_run: bool) -> None:
    if not corpus_db.exists():
        raise SystemExit(f"Corpus database does not exist: {corpus_db}")
    if dry_run:
        count = sum(1 for _ in iter_corpus_papers(corpus_db, limit))
    else:
        with PostgresRepository() as repository:
            count = repository.upsert_corpus_papers(iter_corpus_papers(corpus_db, limit))
    print(f"{'Read' if dry_run else 'Imported'} {count} corpus papers.")


def _reason_system(
    organization_id: str,
    asset_id: str,
    max_claims: int,
    execute: bool,
    retry_failed: bool,
) -> None:
    try:
        if max_claims < 1 or max_claims > MAX_EVIDENCE_CLAIMS:
            raise ReasoningError(
                f"max_claims must be between 1 and {MAX_EVIDENCE_CLAIMS}."
            )
        with PostgresRepository() as repository:
            raw = repository.reasoning_input(organization_id, asset_id, max_claims)
            manifest = build_reasoning_manifest(raw, max_claims)
            counts = {
                "system_instances": len(manifest.payload["system_instances"]),
                "dependencies": len(manifest.payload["dependencies"]),
                "accepted_propagations": len(manifest.payload["accepted_propagations"]),
                "accepted_evidence_claims": len(
                    manifest.payload["accepted_evidence_claims"]
                ),
            }
            if not execute:
                print(json.dumps({"input_hash": manifest.input_hash, **counts}, sort_keys=True))
                print("Preview only. Re-run with --execute to call the reasoning model.")
                return

            config = load_reasoning_config()
            outcome = execute_reasoning(
                repository,
                manifest,
                config,
                retry_failed=retry_failed,
            )
        reused = " (existing idempotent job)" if outcome.reused else ""
        print(
            f"Reasoning job {outcome.job_id}: {outcome.status}, "
            f"{outcome.suggestion_count} suggestion(s){reused}."
        )
    except ReasoningError as exc:
        raise SystemExit(str(exc)) from exc


def _ingest_full_text(limit: int, dry_run: bool, retry_failed: bool) -> None:
    with PostgresRepository() as repository:
        candidates = repository.full_text_candidates(limit, retry_failed)
    counts = {"fetched": 0, "rejected": 0, "failed": 0}
    for candidate in candidates:
        result = fetch_open_access_full_text(candidate)
        counts[result.status] += 1
        if not dry_run:
            with PostgresRepository() as repository:
                repository.save_full_text_result(candidate, result)
        detail = f" ({result.reason})" if result.reason else ""
        print(f"{candidate.paper_candidate_id}: {result.status}{detail}")
    action = "Would process" if dry_run else "Processed"
    print(
        f"{action} {len(candidates)} OA candidate(s): "
        f"{counts['fetched']} fetched, {counts['rejected']} rejected, {counts['failed']} failed."
    )
    if counts["failed"] and not dry_run:
        raise SystemExit(
            f"Full-text ingestion recorded {counts['failed']} transient failure(s)."
        )


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
        outcome = _classify_batch(
            limit,
            mode,
            effective_version,
            extractor,
            llm_config,
            dry_run,
            workers,
            topic_filter,
        )
        print(
            "Classifier batch: "
            f"{outcome.succeeded} succeeded, {outcome.skipped} skipped, "
            f"{outcome.failed} failed, {outcome.fallbacks} fallback(s)."
        )
        if outcome.unhealthy:
            if watch:
                _ping_classifier_healthcheck(success=False)
            raise SystemExit("Classifier batch failed its health threshold.")
        if watch:
            _ping_classifier_healthcheck(success=True)
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
) -> BatchOutcome:
    with PostgresRepository() as repository:
        candidates = repository.pending_candidates(limit, classifier_version, topic_filter)
        taxonomy_terms = (
            repository.active_taxonomy_terms()
            if candidates and extractor in {"auto", "keyword"}
            else ()
        )

    if not candidates:
        return BatchOutcome(selected=0)

    def process(candidate: CandidatePaper) -> str:
        paper = paper_from_candidate(candidate)
        if not (
            (paper.abstract and paper.abstract.strip())
            or (paper.full_text and paper.full_text.strip())
        ):
            if not dry_run:
                with PostgresRepository() as repo:
                    repo.mark_skipped(
                        candidate,
                        classifier_version,
                        mode,
                        "no abstract or full text available",
                    )
            print(f"{candidate.id}: skipped (no abstract or full text)")
            return "skipped"
        result, result_version, llm_failure = _extract_with_provenance(
            paper,
            extractor,
            llm_config,
            classifier_version,
            taxonomy_terms,
        )
        if llm_failure is not None:
            print(f"{candidate.id}: LLM failed, falling back to keyword: {llm_failure}")

        with PostgresRepository() as repo:
            if llm_failure is not None and not dry_run:
                repo.record_failure(candidate, classifier_version, mode, str(llm_failure))
            repo.save_classification(candidate, result, result_version, mode, dry_run)

        claims_returned = result.metadata.get("claims_returned")
        relationships_returned = result.metadata.get("relationships_returned")
        counters = (
            f"claims={len(result.claims)}/{claims_returned} relationships={len(result.relationships)}/{relationships_returned}"
            if claims_returned is not None
            else f"claims={len(result.claims)} relationships={len(result.relationships)}"
        )
        print(f"{candidate.id}: {result.relevance} {counters}")
        return "fallback" if llm_failure is not None else "succeeded"

    counts = {"succeeded": 0, "skipped": 0, "failed": 0, "fallback": 0}
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {pool.submit(process, c): c for c in candidates}
        for future in as_completed(futures):
            candidate = futures[future]
            try:
                counts[future.result()] += 1
            except Exception as exc:
                counts["failed"] += 1
                print(f"{candidate.id}: failed: {exc}")
                if not dry_run:
                    try:
                        with PostgresRepository() as repo:
                            repo.record_failure(candidate, classifier_version, mode, str(exc))
                    except Exception as db_exc:
                        print(f"{candidate.id}: could not persist failure: {db_exc}")

    taxonomy_failed = False
    if (counts["succeeded"] or counts["fallback"]) and not dry_run:
        try:
            with PostgresRepository() as repository:
                linked = repository.link_taxonomy()
            print(f"Taxonomy linking: {_taxonomy_link_summary(linked)}.")
        except Exception as exc:
            taxonomy_failed = True
            print(f"Taxonomy linking failed: {exc}")
    return BatchOutcome(
        selected=len(candidates),
        succeeded=counts["succeeded"] + counts["fallback"],
        skipped=counts["skipped"],
        failed=counts["failed"],
        fallbacks=counts["fallback"],
        taxonomy_failed=taxonomy_failed,
    )


def _extract_with_provenance(
    paper: Paper,
    extractor: str,
    llm_config: LlmConfig | None,
    classifier_version: str,
    taxonomy_terms: tuple[KeywordTerm, ...] = (),
) -> tuple[ClassificationResult, str, LlmExtractorError | None]:
    if llm_config is None:
        return classify_paper(paper, taxonomy_terms), classifier_version, None

    try:
        return extract_with_llm(paper, llm_config), classifier_version, None
    except LlmExtractorError as error:
        if extractor == "llm":
            raise
        return classify_paper(paper, taxonomy_terms), KEYWORD_CLASSIFIER_VERSION, error


def _taxonomy_link_summary(counts: dict[str, int]) -> str:
    return ", ".join(
        f"{count} {label.replace('_', '-')} claim(s)" for label, count in counts.items()
    )


def _ping_classifier_healthcheck(
    url: str | None = None,
    *,
    success: bool = True,
) -> bool:
    healthcheck_url = url if url is not None else os.environ.get("CLASSIFIER_HEALTHCHECK_URL")
    if not healthcheck_url:
        return False
    try:
        target = healthcheck_url.rstrip("/") if success else f"{healthcheck_url.rstrip('/')}/fail"
        request = urllib.request.Request(target, method="GET")
        with urllib.request.urlopen(request, timeout=10) as response:
            response.read(1)
        return True
    except (urllib.error.URLError, OSError) as exc:
        print(f"Classifier healthcheck ping failed: {exc}")
        return False


def _run_eval_command(
    action: Callable[[], int],
    message: Callable[[int], str],
) -> None:
    try:
        count = action()
    except EvaluationFormatError as exc:
        raise SystemExit(str(exc)) from exc
    print(message(count))


if __name__ == "__main__":
    main()
