from __future__ import annotations

import argparse
import os
import time

from paper_discovery.journals import TRUSTED_JOURNALS, Journal
from paper_discovery.models import DiscoveredPaper
from paper_discovery.queries import DISCOVERY_QUERIES
from paper_discovery.repository import DiscoveryRepository
from paper_discovery.sources import crossref, openalex


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Discover candidate engineering failure papers from trusted journals."
    )
    parser.add_argument(
        "--source",
        choices=("crossref", "openalex", "all"),
        default="all",
        help="API source to query. Default: all.",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=100,
        help="Maximum results per (source, journal, query) combination. Default: 100.",
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
        "--mark-stale-days",
        type=int,
        default=None,
        help="After each run, mark papers stale if not seen for this many days.",
    )
    parser.add_argument(
        "--mark-removed-days",
        type=int,
        default=None,
        help="After each run, mark stale papers removed if stale for this many days.",
    )
    args = parser.parse_args()

    queries = tuple(args.queries) if args.queries else DISCOVERY_QUERIES
    journals = (
        tuple(Journal(issn, issn) for issn in args.issns)
        if args.issns
        else TRUSTED_JOURNALS
    )
    contact_email = os.environ.get("DISCOVERY_CONTACT_EMAIL")

    while True:
        _run_discovery(
            args.source,
            journals,
            queries,
            args.limit,
            args.dry_run,
            contact_email,
            args.mark_stale_days,
            args.mark_removed_days,
        )
        if not args.watch:
            break
        time.sleep(max(args.interval_seconds, 1))


def _run_discovery(
    source: str,
    journals: tuple[Journal, ...],
    queries: tuple[str, ...],
    limit: int,
    dry_run: bool,
    contact_email: str | None,
    mark_stale_days: int | None,
    mark_removed_days: int | None,
) -> None:
    sources = _sources_for(source)
    total = 0

    for source_name, fetch_fn in sources:
        for journal in journals:
            for query in queries:
                label = f"[{source_name}] {journal.name} ({journal.issn}) / '{query}'"
                count = _fetch_and_store(
                    source_name=source_name,
                    fetch_fn=fetch_fn,
                    journal=journal,
                    query=query,
                    limit=limit,
                    dry_run=dry_run,
                    contact_email=contact_email,
                )
                if count > 0:
                    print(f"{label}: {count} paper(s)")
                total += count

    if mark_stale_days is not None and not dry_run:
        with DiscoveryRepository() as repo:
            stale_count = repo.mark_stale(mark_stale_days)
        print(f"Marked {stale_count} paper(s) stale after {mark_stale_days} day(s) without rediscovery.")

    if mark_removed_days is not None and not dry_run:
        with DiscoveryRepository() as repo:
            removed_count = repo.mark_removed(mark_removed_days)
        print(f"Marked {removed_count} stale paper(s) removed after {mark_removed_days} stale day(s).")

    action = "Would store" if dry_run else "Observed"
    print(f"\n{action} {total} total paper(s) across all sources and queries.")


def _fetch_and_store(
    source_name: str,
    fetch_fn: object,
    journal: Journal,
    query: str,
    limit: int,
    dry_run: bool,
    contact_email: str | None,
) -> int:
    try:
        papers = list(
            fetch_fn(
                issn=journal.issn,
                query=query,
                limit=limit,
                contact_email=contact_email,
            )
        )
    except (crossref.DiscoverySourceError, openalex.DiscoverySourceError) as exc:
        print(f"  Warning: {exc}")
        return 0

    if not papers or dry_run:
        return len(papers)

    try:
        with DiscoveryRepository() as repo:
            run_id = repo.start_run(source=source_name, query=f"{journal.issn}/{query}")
            try:
                stats = repo.upsert_papers(run_id, papers)
                repo.finish_run(run_id, stats)
                return stats.stored
            except Exception as exc:
                repo.fail_run(run_id, str(exc))
                raise
    except Exception as exc:
        print(f"  Warning: DB write failed: {exc}")
        return 0


def _sources_for(source: str) -> list[tuple[str, object]]:
    if source == "crossref":
        return [("crossref", crossref.fetch)]
    if source == "openalex":
        return [("openalex", openalex.fetch)]
    return [("crossref", crossref.fetch), ("openalex", openalex.fetch)]


if __name__ == "__main__":
    main()
