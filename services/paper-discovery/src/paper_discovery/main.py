from __future__ import annotations

import argparse
import os
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from paper_discovery.journals import TRUSTED_JOURNALS, Journal
from paper_discovery.models import DiscoveredPaper
from paper_discovery.queries import DISCOVERY_QUERIES
from paper_discovery.repository import DiscoveryRepository
from paper_discovery.sources import openalex


@dataclass(frozen=True)
class SourceCallResult:
    paper_count: int
    source_succeeded: bool
    db_write_failed: bool = False


class DiscoverySweepError(RuntimeError):
    pass


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Discover candidate engineering failure papers from trusted journals via OpenAlex."
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=100,
        help="Maximum results per (journal, query) combination. Default: 100.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Fetch and print counts without writing to the database.",
    )
    parser.add_argument(
        "--watch",
        action="store_true",
        help="Continuously re-run discovery on a fixed interval.",
    )
    parser.add_argument(
        "--interval-seconds",
        type=int,
        default=3600,
        help="Polling interval for --watch. Default: 3600 (1 hour).",
    )
    parser.add_argument(
        "--query",
        action="append",
        default=[],
        dest="queries",
        metavar="QUERY",
        help="Override search queries (can repeat). Default: built-in list.",
    )
    parser.add_argument(
        "--issn",
        action="append",
        default=[],
        dest="issns",
        metavar="ISSN",
        help="Override trusted journal ISSNs (can repeat). Default: built-in list.",
    )
    parser.add_argument(
        "--since-days",
        type=int,
        default=None,
        help="Only fetch papers published in the last N days (incremental sweep). Default: no date filter.",
    )
    parser.add_argument(
        "--backfill-oa",
        action="store_true",
        help="Instead of a sweep, backfill open-access + citation metadata for existing papers (uses --limit as batch size).",
    )
    args = parser.parse_args()

    queries = tuple(args.queries) if args.queries else DISCOVERY_QUERIES
    journals = (
        tuple(Journal(issn, issn) for issn in args.issns)
        if args.issns
        else TRUSTED_JOURNALS
    )
    contact_email = os.environ.get("DISCOVERY_CONTACT_EMAIL")

    if args.backfill_oa:
        _backfill_oa(args.limit, args.dry_run, contact_email)
        return

    while True:
        from_publication_date = None
        if args.since_days is not None:
            from_publication_date = (
                datetime.now(timezone.utc).date() - timedelta(days=args.since_days)
            ).isoformat()
        _run_discovery(
            journals,
            queries,
            args.limit,
            args.dry_run,
            contact_email,
            from_publication_date,
        )
        if not args.watch:
            break
        time.sleep(max(args.interval_seconds, 1))


def _run_discovery(
    journals: tuple[Journal, ...],
    queries: tuple[str, ...],
    limit: int,
    dry_run: bool,
    contact_email: str | None,
    from_publication_date: str | None,
) -> None:
    total = 0
    successful_source_calls = 0
    failed_source_calls = 0
    db_write_failures = 0

    for journal in journals:
        for query in queries:
            label = f"{journal.name} ({journal.issn}) / '{query}'"
            outcome = _fetch_and_store(
                journal=journal,
                query=query,
                limit=limit,
                dry_run=dry_run,
                contact_email=contact_email,
                from_publication_date=from_publication_date,
            )
            if outcome.paper_count > 0:
                print(f"{label}: {outcome.paper_count} paper(s)")
            total += outcome.paper_count
            successful_source_calls += int(outcome.source_succeeded)
            failed_source_calls += int(not outcome.source_succeeded)
            db_write_failures += int(outcome.db_write_failed)

    action = "Would store" if dry_run else "Observed"
    print(f"\n{action} {total} total paper(s) across all queries.")
    if failed_source_calls:
        print(
            f"OpenAlex source calls: {successful_source_calls} succeeded, "
            f"{failed_source_calls} failed."
        )
    if db_write_failures:
        raise DiscoverySweepError(
            f"{db_write_failures} discovery call(s) fetched data but failed to persist it"
        )
    if successful_source_calls == 0:
        raise DiscoverySweepError("all OpenAlex source calls failed")

def _backfill_oa(limit: int, dry_run: bool, contact_email: str | None) -> None:
    """Annotate existing papers with open-access availability and citation counts."""
    with DiscoveryRepository() as repo:
        candidates = repo.candidates_missing_oa(limit)
    print(f"Backfilling OA metadata for {len(candidates)} paper(s)...")

    oa_count = 0
    missing = 0
    errors = 0
    for candidate in candidates:
        try:
            work = openalex.fetch_work_by_doi(candidate["doi"], contact_email)
        except openalex.DiscoverySourceError as exc:
            errors += 1
            print(f"  Warning: {candidate['doi']}: {exc}")
            continue

        patch: dict[str, object] = {"oa_checked": True}
        if work is not None:
            open_access = work.get("open_access") or {}
            best_oa_location = work.get("best_oa_location") or {}
            patch["is_oa"] = bool(open_access.get("is_oa"))
            oa_url = best_oa_location.get("pdf_url") or open_access.get("oa_url")
            if oa_url:
                patch["oa_url"] = oa_url
            if open_access.get("oa_status"):
                patch["oa_status"] = open_access["oa_status"]
            if best_oa_location.get("license"):
                patch["oa_license"] = best_oa_location["license"]
                license_url = openalex.license_url_for(best_oa_location["license"])
                if license_url:
                    patch["oa_license_url"] = license_url
            if best_oa_location.get("version"):
                patch["oa_version"] = best_oa_location["version"]
            if work.get("cited_by_count") is not None:
                patch["cited_by_count"] = work["cited_by_count"]
            if patch.get("is_oa"):
                oa_count += 1
        else:
            patch["is_oa"] = False
            missing += 1

        if not dry_run:
            with DiscoveryRepository() as repo:
                repo.merge_discovery_metadata(str(candidate["id"]), patch)
        time.sleep(0.1)  # OpenAlex polite rate limit

    action = "Would update" if dry_run else "Updated"
    print(
        f"{action} {len(candidates) - errors} paper(s): "
        f"{oa_count} open access, {missing} not found on OpenAlex, {errors} error(s)."
    )


def _fetch_and_store(
    journal: Journal,
    query: str,
    limit: int,
    dry_run: bool,
    contact_email: str | None,
    from_publication_date: str | None = None,
) -> SourceCallResult:
    try:
        papers = list(
            openalex.fetch(
                issn=journal.issn,
                query=query,
                limit=limit,
                contact_email=contact_email,
                from_publication_date=from_publication_date,
            )
        )
    except openalex.DiscoverySourceError as exc:
        print(f"  Warning: {exc}")
        return SourceCallResult(0, source_succeeded=False)

    if not papers or dry_run:
        return SourceCallResult(len(papers), source_succeeded=True)

    try:
        with DiscoveryRepository() as repo:
            run_id = repo.start_run(source="openalex", query=f"{journal.issn}/{query}")
            try:
                stats = repo.upsert_papers(run_id, papers)
                repo.finish_run(run_id, stats)
                return SourceCallResult(stats.stored, source_succeeded=True)
            except Exception as exc:
                repo.fail_run(run_id, str(exc))
                raise
    except Exception as exc:
        print(f"  Warning: DB write failed: {exc}")
        return SourceCallResult(0, source_succeeded=True, db_write_failed=True)


if __name__ == "__main__":
    main()
