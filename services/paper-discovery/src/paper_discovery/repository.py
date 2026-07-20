from __future__ import annotations

import json
import os
from collections.abc import Iterable
from contextlib import AbstractContextManager
from dataclasses import dataclass
from typing import Any

import psycopg
from psycopg.rows import dict_row

from paper_discovery.models import DiscoveredPaper


@dataclass(frozen=True)
class DiscoveryWriteStats:
    inserted: int = 0
    updated: int = 0
    unchanged: int = 0
    skipped: int = 0

    @property
    def stored(self) -> int:
        return self.inserted + self.updated + self.unchanged


class DiscoveryRepository(AbstractContextManager["DiscoveryRepository"]):
    def __init__(self, database_url: str | None = None) -> None:
        self.database_url = database_url or os.environ.get("DATABASE_URL") or os.environ.get("SUPABASE_DB_URL")
        if not self.database_url:
            raise RuntimeError("Set DATABASE_URL or SUPABASE_DB_URL for the discovery service.")
        self.connection: psycopg.Connection[dict[str, Any]] | None = None

    def __enter__(self) -> "DiscoveryRepository":
        self.connection = psycopg.connect(self.database_url, row_factory=dict_row, autocommit=True)
        return self

    def __exit__(self, *exc_info: object) -> None:
        if self.connection is not None:
            self.connection.close()

    def start_run(self, source: str, query: str) -> str:
        row = self._conn().execute(
            """
            insert into papers_raw.discovery_runs (source, query, status, started_at, metadata)
            values (%(source)s, %(query)s, 'running', now(), '{}'::jsonb)
            returning id
            """,
            {"source": source, "query": query},
        ).fetchone()
        return str(row["id"])

    def finish_run(self, run_id: str, stats: DiscoveryWriteStats, status: str = "finished") -> None:
        self._conn().execute(
            """
            update papers_raw.discovery_runs
            set status = %(status)s,
                finished_at = now(),
                metadata = coalesce(metadata, '{}'::jsonb) || %(metadata)s::jsonb
            where id = %(run_id)s
            """,
            {
                "run_id": run_id,
                "status": status,
                "metadata": json.dumps(
                    {
                        "papers_found": stats.stored,
                        "inserted": stats.inserted,
                        "updated": stats.updated,
                        "unchanged": stats.unchanged,
                        "skipped": stats.skipped,
                        "write_committed": True,
                    }
                ),
            },
        )

    def fail_run(self, run_id: str, error: str) -> None:
        self._conn().execute(
            """
            update papers_raw.discovery_runs
            set status = 'failed',
                finished_at = now(),
                metadata = coalesce(metadata, '{}'::jsonb) || %(metadata)s::jsonb
            where id = %(run_id)s
            """,
            {
                "run_id": run_id,
                "metadata": json.dumps(
                    {
                        "error": error,
                        "papers_found": 0,
                        "write_committed": False,
                    }
                ),
            },
        )

    def upsert_papers(self, run_id: str, papers: Iterable[DiscoveredPaper]) -> DiscoveryWriteStats:
        inserted = 0
        updated = 0
        unchanged = 0
        skipped = 0
        # One source-call batch is all-or-nothing.  The connection itself uses
        # autocommit for run lifecycle updates, so an explicit transaction is
        # required here to prevent a failed batch from leaving partially
        # written candidates while its discovery run is marked failed.
        with self._conn().transaction():
            for paper in papers:
                if not paper.title_fingerprint:
                    skipped += 1
                    continue

                existing = self._find_existing_candidate(paper)
                if existing is None:
                    if self._insert_paper(run_id, paper):
                        inserted += 1
                        continue

                    # Another discovery run inserted this DOI between our
                    # lookup and insert. Resolve it inside this transaction.
                    existing = self._find_existing_candidate(paper)
                    if existing is None:
                        raise RuntimeError("Conflicting paper insert could not be resolved.")

                changed = self._update_paper(existing, run_id, paper)
                if changed:
                    updated += 1
                else:
                    unchanged += 1

        return DiscoveryWriteStats(inserted, updated, unchanged, skipped)

    def _find_existing_candidate(self, paper: DiscoveredPaper) -> dict[str, Any] | None:
        if paper.canonical_doi:
            row = self._conn().execute(
                """
                select id, title, abstract, classification_status, lifecycle_status
                from papers_raw.paper_candidates
                where canonical_doi = %(canonical_doi)s
                   or lower(doi) = %(canonical_doi)s
                order by created_at asc
                limit 1
                """,
                {"canonical_doi": paper.canonical_doi},
            ).fetchone()
            if row:
                return row

        if paper.title_fingerprint:
            row = self._conn().execute(
                """
                select id, title, abstract, classification_status, lifecycle_status
                from papers_raw.paper_candidates
                where title_fingerprint = %(title_fingerprint)s
                  and publication_year is not distinct from %(publication_year)s
                order by created_at asc
                limit 1
                """,
                {
                    "title_fingerprint": paper.title_fingerprint,
                    "publication_year": paper.year,
                },
            ).fetchone()
            if row:
                return row

        if paper.abstract_hash:
            return self._conn().execute(
                """
                select id, title, abstract, classification_status, lifecycle_status
                from papers_raw.paper_candidates
                where abstract_hash = %(abstract_hash)s
                order by created_at asc
                limit 1
                """,
                {"abstract_hash": paper.abstract_hash},
            ).fetchone()

        return None

    def _insert_paper(self, run_id: str, paper: DiscoveredPaper) -> bool:
        row = self._conn().execute(
            """
            insert into papers_raw.paper_candidates (
              discovery_run_id,
              doi,
              canonical_doi,
              title,
              title_fingerprint,
              abstract,
              abstract_hash,
              authors,
              first_author,
              journal,
              publication_year,
              source_url,
              source,
              external_ids,
              lifecycle_status,
              classification_status,
              first_seen_at,
              last_seen_at,
              stale_at,
              removed_at,
              discovery_score,
              discovery_metadata,
              raw_payload
            )
            values (
              %(discovery_run_id)s,
              %(doi)s,
              %(canonical_doi)s,
              %(title)s,
              %(title_fingerprint)s,
              %(abstract)s,
              %(abstract_hash)s,
              %(authors)s::jsonb,
              %(first_author)s,
              %(journal)s,
              %(publication_year)s,
              %(source_url)s,
              %(source)s,
              %(external_ids)s::jsonb,
              'pending_classification',
              'pending',
              now(),
              now(),
              null,
              null,
              %(discovery_score)s,
              %(discovery_metadata)s::jsonb,
              %(raw_payload)s::jsonb
            )
            on conflict (doi) do nothing
            returning id
            """,
            self._paper_params(run_id, paper),
        ).fetchone()
        return row is not None

    def _update_paper(self, existing: dict[str, Any], run_id: str, paper: DiscoveredPaper) -> bool:
        next_abstract = paper.abstract or existing["abstract"]
        changed = existing["title"] != paper.title or existing["abstract"] != next_abstract

        self._conn().execute(
            """
            update papers_raw.paper_candidates
            set discovery_run_id = %(discovery_run_id)s,
                doi = coalesce(%(doi)s, doi),
                canonical_doi = coalesce(%(canonical_doi)s, canonical_doi),
                title = %(title)s,
                title_fingerprint = %(title_fingerprint)s,
                abstract = coalesce(%(abstract)s, abstract),
                abstract_hash = coalesce(%(abstract_hash)s, abstract_hash),
                authors = %(authors)s::jsonb,
                first_author = %(first_author)s,
                journal = coalesce(%(journal)s, journal),
                publication_year = coalesce(%(publication_year)s, publication_year),
                source_url = coalesce(%(source_url)s, source_url),
                external_ids = coalesce(external_ids, '{}'::jsonb) || %(external_ids)s::jsonb,
                raw_payload = coalesce(raw_payload, '{}'::jsonb) || %(raw_payload)s::jsonb,
                discovery_score = greatest(coalesce(discovery_score, 0), %(discovery_score)s),
                discovery_metadata = coalesce(discovery_metadata, '{}'::jsonb) || %(discovery_metadata)s::jsonb,
                last_seen_at = now(),
                stale_at = null,
                removed_at = null,
                lifecycle_status = case
                  when title is distinct from %(title)s
                    or abstract is distinct from coalesce(%(abstract)s, abstract)
                  then 'pending_classification'
                  when lifecycle_status in ('stale', 'removed') and classification_status = 'classified'
                  then 'classified'
                  when lifecycle_status in ('stale', 'removed')
                  then 'pending_classification'
                  else lifecycle_status
                end,
                classification_status = case
                  when title is distinct from %(title)s
                    or abstract is distinct from coalesce(%(abstract)s, abstract)
                  then 'pending'
                  else classification_status
                end,
                classification_lease_token = case
                  when title is distinct from %(title)s
                    or abstract is distinct from coalesce(%(abstract)s, abstract)
                  then null else classification_lease_token
                end,
                classification_lease_expires_at = case
                  when title is distinct from %(title)s
                    or abstract is distinct from coalesce(%(abstract)s, abstract)
                  then null else classification_lease_expires_at
                end
            where id = %(paper_id)s
            """,
            {**self._paper_params(run_id, paper), "paper_id": existing["id"]},
        )
        return changed

    def _paper_params(self, run_id: str, paper: DiscoveredPaper) -> dict[str, Any]:
        return {
            "discovery_run_id": run_id,
            "doi": paper.doi,
            "canonical_doi": paper.canonical_doi,
            "title": paper.title,
            "title_fingerprint": paper.title_fingerprint,
            "abstract": paper.abstract,
            "abstract_hash": paper.abstract_hash,
            "authors": json.dumps(paper.authors),
            "first_author": paper.first_author,
            "journal": paper.journal,
            "publication_year": paper.year,
            "source_url": paper.source_url,
            "source": "discovery",
            "external_ids": json.dumps(paper.external_ids),
            "discovery_score": _discovery_score(paper),
            "discovery_metadata": json.dumps(_discovery_metadata(paper)),
            "raw_payload": json.dumps(paper.raw_payload),
        }

    def candidates_missing_oa(self, limit: int) -> list[dict[str, Any]]:
        """Papers with a real DOI that have never been checked for open access."""
        rows = self._conn().execute(
            """
            select id, doi
            from papers_raw.paper_candidates
            where doi is not null
              and doi not like 'easa-ad:%%'
              and (discovery_metadata->>'oa_checked') is null
            order by publication_year desc nulls last
            limit %(limit)s
            """,
            {"limit": limit},
        ).fetchall()
        return [dict(row) for row in rows]

    def merge_discovery_metadata(self, paper_id: str, patch: dict[str, Any]) -> None:
        self._conn().execute(
            """
            update papers_raw.paper_candidates
            set discovery_metadata = coalesce(discovery_metadata, '{}'::jsonb) || %(patch)s::jsonb
            where id = %(paper_id)s
            """,
            {"paper_id": paper_id, "patch": json.dumps(patch)},
        )

    def _conn(self) -> psycopg.Connection[dict[str, Any]]:
        if self.connection is None:
            raise RuntimeError("Repository must be used as a context manager.")
        return self.connection


def _discovery_metadata(paper: DiscoveredPaper) -> dict[str, Any]:
    metadata: dict[str, Any] = {"dedupe_strategy": "doi_title_year_abstract"}
    if paper.is_oa is not None:
        metadata["oa_checked"] = True
        metadata["is_oa"] = paper.is_oa
    if paper.oa_url:
        metadata["oa_url"] = paper.oa_url
    if paper.oa_status:
        metadata["oa_status"] = paper.oa_status
    if paper.oa_license:
        metadata["oa_license"] = paper.oa_license
    if paper.oa_license_url:
        metadata["oa_license_url"] = paper.oa_license_url
    if paper.oa_version:
        metadata["oa_version"] = paper.oa_version
    if paper.cited_by_count is not None:
        metadata["cited_by_count"] = paper.cited_by_count
    return metadata


def _discovery_score(paper: DiscoveredPaper) -> float:
    score = 0.25
    if paper.canonical_doi:
        score += 0.2
    if paper.abstract:
        score += 0.2
    if paper.year and paper.year >= 2015:
        score += 0.05
    haystack = f"{paper.title} {paper.abstract or ''}".lower()
    if any(term in haystack for term in ("failure", "fracture", "fatigue", "corrosion", "wear", "fmea", "reliability")):
        score += 0.2
    if paper.journal:
        score += 0.1
    return min(score, 1.0)
