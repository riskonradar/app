from __future__ import annotations

import hashlib
import json
import os
from collections.abc import Iterable
from contextlib import AbstractContextManager
from dataclasses import dataclass
from typing import Any

import psycopg
from psycopg.rows import dict_row

from paper_classifier.models import ClassificationResult, Paper


@dataclass(frozen=True)
class CandidatePaper:
    id: str
    doi: str | None
    title: str
    abstract: str | None
    journal: str | None
    publication_year: int | None
    authors: list[Any]
    source_url: str | None
    source: str


class PostgresRepository(AbstractContextManager["PostgresRepository"]):
    def __init__(self, database_url: str | None = None) -> None:
        self.database_url = database_url or os.environ.get("DATABASE_URL") or os.environ.get("SUPABASE_DB_URL")
        if not self.database_url:
            raise RuntimeError("Set DATABASE_URL or SUPABASE_DB_URL for the classifier service.")
        self.connection: psycopg.Connection[dict[str, Any]] | None = None

    def __enter__(self) -> "PostgresRepository":
        self.connection = psycopg.connect(self.database_url, row_factory=dict_row, autocommit=True)
        return self

    def __exit__(self, *exc_info: object) -> None:
        if self.connection is not None:
            self.connection.close()

    def upsert_corpus_papers(self, papers: Iterable[Paper], dry_run: bool = False) -> int:
        count = 0
        with self._connection().transaction():
            discovery_run_id = None
            if not dry_run:
                discovery_run_id = self._connection().execute(
                    """
                    insert into papers_raw.discovery_runs (source, query, status, started_at, finished_at, metadata)
                    values ('corpus_backfill', 'riskonradar/corpus corpus.db', 'finished', now(), now(), '{}'::jsonb)
                    returning id
                    """
                ).fetchone()["id"]

            for paper in papers:
                count += 1
                if dry_run:
                    continue
                self._connection().execute(
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
                      nullif(
                        lower(
                          regexp_replace(
                            regexp_replace(coalesce(%(doi)s, ''), '^https?://(dx\\.)?doi\\.org/', '', 'i'),
                            '^doi:\\s*',
                            '',
                            'i'
                          )
                        ),
                        ''
                      ),
                      %(title)s,
                      nullif(regexp_replace(extensions.unaccent(lower(%(title)s)), '[^a-z0-9]+', '', 'g'), ''),
                      %(abstract)s,
                      case
                        when %(abstract)s is null or trim(%(abstract)s) = '' then null
                        else encode(sha256(convert_to(trim(regexp_replace(extensions.unaccent(lower(%(abstract)s)), '\\s+', ' ', 'g')), 'utf8')), 'hex')
                      end,
                      %(authors)s::jsonb,
                      nullif(trim(regexp_replace(extensions.unaccent(lower(%(authors)s::jsonb ->> 0)), '\\s+', ' ', 'g')), ''),
                      %(journal)s,
                      %(publication_year)s,
                      %(source_url)s,
                      'corpus',
                      %(external_ids)s::jsonb,
                      'pending_classification',
                      'pending',
                      now(),
                      now(),
                      null,
                      null,
                      0.75,
                      '{"importer": "corpus_backfill"}'::jsonb,
                      %(raw_payload)s::jsonb
                    )
                    on conflict (doi) do update set
                      title = excluded.title,
                      title_fingerprint = excluded.title_fingerprint,
                      abstract = excluded.abstract,
                      abstract_hash = excluded.abstract_hash,
                      authors = excluded.authors,
                      first_author = excluded.first_author,
                      journal = excluded.journal,
                      publication_year = excluded.publication_year,
                      source_url = excluded.source_url,
                      external_ids = papers_raw.paper_candidates.external_ids || excluded.external_ids,
                      last_seen_at = now(),
                      stale_at = null,
                      removed_at = null,
                      discovery_score = greatest(coalesce(papers_raw.paper_candidates.discovery_score, 0), excluded.discovery_score),
                      discovery_metadata = papers_raw.paper_candidates.discovery_metadata || excluded.discovery_metadata,
                      raw_payload = papers_raw.paper_candidates.raw_payload || excluded.raw_payload,
                      lifecycle_status = case
                        when papers_raw.paper_candidates.title is distinct from excluded.title
                          or papers_raw.paper_candidates.abstract is distinct from excluded.abstract
                        then 'pending_classification'
                        when papers_raw.paper_candidates.lifecycle_status in ('stale', 'removed')
                          and papers_raw.paper_candidates.classification_status = 'classified'
                        then 'classified'
                        when papers_raw.paper_candidates.lifecycle_status in ('stale', 'removed')
                        then 'pending_classification'
                        else papers_raw.paper_candidates.lifecycle_status
                      end,
                      classification_status = case
                        when papers_raw.paper_candidates.title is distinct from excluded.title
                          or papers_raw.paper_candidates.abstract is distinct from excluded.abstract
                        then 'pending'
                        else papers_raw.paper_candidates.classification_status
                      end
                    """,
                    {
                        "discovery_run_id": discovery_run_id,
                        "doi": paper.doi,
                        "title": paper.title,
                        "abstract": paper.abstract,
                        "authors": _authors_json(paper.authors),
                        "journal": paper.journal,
                        "publication_year": paper.year,
                        "source_url": paper.url,
                        "external_ids": json.dumps(
                            {
                                key: value
                                for key, value in {
                                    "corpus": paper.id,
                                    "openalex": paper.openalex_id,
                                }.items()
                                if value
                            }
                        ),
                        "raw_payload": json.dumps(
                            {
                                "corpus_id": paper.id,
                                "corpus_source": paper.source,
                                "cited_by": paper.cited_by,
                                "openalex_id": paper.openalex_id,
                            }
                        ),
                    },
                )
        return count

    def pending_candidates(self, limit: int, classifier_version: str, topic_filter: str | None = None) -> list[CandidatePaper]:
        where_clauses = [
            "coalesce(pc.lifecycle_status, 'pending_classification') not in ('stale', 'removed')",
            "pc.classification_status is distinct from 'skipped'",
            """(
                pc.classification_status in ('pending', 'failed')
                or not exists (
                  select 1
                  from knowledge.classification_jobs cj
                  where cj.paper_candidate_id = pc.id
                    and cj.classifier_version = %(classifier_version)s
                    and cj.status = 'completed'
                )
              )""",
            """not exists (
                select 1
                from knowledge.classification_jobs cjf
                where cjf.paper_candidate_id = pc.id
                  and cjf.classifier_version = %(classifier_version)s
                  and cjf.status = 'failed'
                  and cjf.attempts >= 3
              )""",
        ]
        
        params = {"limit": limit, "classifier_version": classifier_version}
        
        if topic_filter:
            where_clauses.append("""(
                lower(pc.title) LIKE %(topic_filter)s
                OR lower(pc.abstract) LIKE %(topic_filter)s
            )""")
            params["topic_filter"] = f"%{topic_filter.lower()}%"
        
        where_clause = " AND ".join(where_clauses)
        
        rows = self._connection().execute(
            f"""
            select pc.id, pc.doi, pc.title, pc.abstract, pc.journal, pc.publication_year, pc.authors, pc.source_url, pc.source
            from papers_raw.paper_candidates pc
            where {where_clause}
            order by pc.publication_year desc nulls last, pc.created_at asc
            limit %(limit)s
            """,
            params,
        ).fetchall()
        return [
            CandidatePaper(
                id=str(row["id"]),
                doi=row["doi"],
                title=row["title"],
                abstract=row["abstract"],
                journal=row["journal"],
                publication_year=row["publication_year"],
                authors=row["authors"] or [],
                source_url=row["source_url"],
                source=row["source"],
            )
            for row in rows
        ]

    def save_classification(
        self,
        candidate: CandidatePaper,
        result: ClassificationResult,
        classifier_version: str,
        mode: str,
        dry_run: bool = False,
    ) -> None:
        if dry_run:
            return

        input_hash = input_hash_for(candidate.title, candidate.abstract)
        with self._connection().transaction():
            job_id = self._connection().execute(
                """
                insert into knowledge.classification_jobs (
                  paper_candidate_id,
                  input_hash,
                  classifier_version,
                  mode,
                  status,
                  attempts,
                  started_at,
                  completed_at,
                  classifier_metadata
                )
                values (
                  %(paper_candidate_id)s,
                  %(input_hash)s,
                  %(classifier_version)s,
                  %(mode)s,
                  'completed',
                  1,
                  now(),
                  now(),
                  %(metadata)s::jsonb
                )
                on conflict (paper_candidate_id, input_hash, classifier_version) do update set
                  mode = excluded.mode,
                  status = 'completed',
                  attempts = knowledge.classification_jobs.attempts + 1,
                  started_at = excluded.started_at,
                  completed_at = excluded.completed_at,
                  last_error = null,
                  classifier_metadata = excluded.classifier_metadata
                returning id
                """,
                {
                    "paper_candidate_id": candidate.id,
                    "input_hash": input_hash,
                    "classifier_version": classifier_version,
                    "mode": mode,
                    "metadata": json.dumps(result.metadata),
                },
            ).fetchone()["id"]

            # Supersede unreviewed claims from earlier jobs for this paper instead of
            # deleting them: preserves human review state and FMEA evidence links.
            self._connection().execute(
                """
                update knowledge.evidence_claims
                set review_status = 'superseded'
                where paper_candidate_id = %(paper_candidate_id)s
                  and classification_job_id <> %(job_id)s
                  and review_status = 'needs_review'
                """,
                {"paper_candidate_id": candidate.id, "job_id": job_id},
            )
            # Same-job replay (crash mid-batch): safe to delete, the claims were
            # written seconds ago and cannot have been reviewed or cited yet.
            self._connection().execute("delete from knowledge.evidence_claims where classification_job_id = %(job_id)s", {"job_id": job_id})

            claim_ids: list[str] = []
            for claim in result.claims:
                claim_id = self._connection().execute(
                    """
                    insert into knowledge.evidence_claims (
                      paper_candidate_id,
                      classification_job_id,
                      claim_type,
                      raw_value,
                      normalized_value,
                      support_type,
                      inference_rationale,
                      confidence,
                      metadata
                    )
                    values (
                      %(paper_candidate_id)s,
                      %(classification_job_id)s,
                      %(claim_type)s,
                      %(raw_value)s,
                      %(normalized_value)s,
                      %(support_type)s,
                      %(inference_rationale)s,
                      %(confidence)s,
                      %(metadata)s::jsonb
                    )
                    returning id
                    """,
                    {
                        "paper_candidate_id": candidate.id,
                        "classification_job_id": job_id,
                        "claim_type": claim.claim_type.value,
                        "raw_value": claim.raw_value,
                        "normalized_value": claim.normalized_value,
                        "support_type": claim.support_type.value,
                        "inference_rationale": claim.inference_rationale,
                        "confidence": claim.confidence,
                        "metadata": json.dumps(claim.metadata),
                    },
                ).fetchone()["id"]
                claim_ids.append(str(claim_id))

                for span in claim.spans:
                    self._connection().execute(
                        """
                        insert into knowledge.evidence_spans (
                          evidence_claim_id,
                          source_field,
                          text,
                          char_start,
                          char_end,
                          license_safe
                        )
                        values (
                          %(evidence_claim_id)s,
                          %(source_field)s,
                          %(text)s,
                          %(char_start)s,
                          %(char_end)s,
                          %(license_safe)s
                        )
                        """,
                        {
                            "evidence_claim_id": claim_id,
                            "source_field": span.source_field,
                            "text": span.text,
                            "char_start": span.char_start,
                            "char_end": span.char_end,
                            "license_safe": span.license_safe,
                        },
                    )

            for relationship in result.relationships:
                if relationship.subject_index >= len(claim_ids) or relationship.object_index >= len(claim_ids):
                    continue
                self._connection().execute(
                    """
                    insert into knowledge.claim_relationships (
                      paper_candidate_id,
                      classification_job_id,
                      subject_claim_id,
                      relationship_type,
                      object_claim_id,
                      support_type,
                      confidence,
                      metadata
                    )
                    values (
                      %(paper_candidate_id)s,
                      %(classification_job_id)s,
                      %(subject_claim_id)s,
                      %(relationship_type)s,
                      %(object_claim_id)s,
                      %(support_type)s,
                      %(confidence)s,
                      %(metadata)s::jsonb
                    )
                    """,
                    {
                        "paper_candidate_id": candidate.id,
                        "classification_job_id": job_id,
                        "subject_claim_id": claim_ids[relationship.subject_index],
                        "relationship_type": relationship.relationship_type.value,
                        "object_claim_id": claim_ids[relationship.object_index],
                        "support_type": relationship.support_type.value,
                        "confidence": relationship.confidence,
                        "metadata": json.dumps(relationship.metadata),
                    },
                )

            self._connection().execute(
                """
                insert into knowledge.paper_classifications (
                  paper_candidate_id,
                  relevance,
                  confidence,
                  model_name,
                  model_version,
                  classifier_metadata
                )
                values (
                  %(paper_candidate_id)s,
                  %(relevance)s,
                  %(confidence)s,
                  %(model_name)s,
                  %(classifier_version)s,
                  %(metadata)s::jsonb
                )
                """,
                {
                    "paper_candidate_id": candidate.id,
                    "relevance": result.relevance,
                    "confidence": result.confidence,
                    "model_name": result.metadata.get("llm_model") or "keyword-span-preprocessor",
                    "classifier_version": classifier_version,
                    "metadata": json.dumps(result.metadata),
                },
            )

            self._connection().execute(
                """
                update papers_raw.paper_candidates
                set classification_status = 'classified',
                    lifecycle_status = 'classified',
                    stale_at = null,
                    removed_at = null
                where id = %(paper_candidate_id)s
                """,
                {"paper_candidate_id": candidate.id},
            )

    def mark_skipped(
        self,
        candidate: CandidatePaper,
        classifier_version: str,
        mode: str,
        reason: str,
    ) -> None:
        """Terminal state for papers that can never be classified (e.g. no abstract)."""
        self._upsert_job_status(candidate, classifier_version, mode, "skipped", reason)
        self._connection().execute(
            "update papers_raw.paper_candidates set classification_status = 'skipped' where id = %(id)s",
            {"id": candidate.id},
        )

    def record_failure(
        self,
        candidate: CandidatePaper,
        classifier_version: str,
        mode: str,
        error: str,
    ) -> None:
        """Persist a failed attempt; papers with 3 failed attempts stop being re-polled."""
        self._upsert_job_status(candidate, classifier_version, mode, "failed", error[:2000])
        self._connection().execute(
            "update papers_raw.paper_candidates set classification_status = 'failed' where id = %(id)s",
            {"id": candidate.id},
        )

    def _upsert_job_status(
        self,
        candidate: CandidatePaper,
        classifier_version: str,
        mode: str,
        status: str,
        last_error: str,
    ) -> None:
        self._connection().execute(
            """
            insert into knowledge.classification_jobs (
              paper_candidate_id, input_hash, classifier_version, mode,
              status, attempts, started_at, last_error
            )
            values (
              %(paper_candidate_id)s, %(input_hash)s, %(classifier_version)s, %(mode)s,
              %(status)s, 1, now(), %(last_error)s
            )
            on conflict (paper_candidate_id, input_hash, classifier_version) do update set
              mode = excluded.mode,
              status = excluded.status,
              attempts = knowledge.classification_jobs.attempts + 1,
              started_at = excluded.started_at,
              last_error = excluded.last_error
            """,
            {
                "paper_candidate_id": candidate.id,
                "input_hash": input_hash_for(candidate.title, candidate.abstract),
                "classifier_version": classifier_version,
                "mode": mode,
                "status": status,
                "last_error": last_error,
            },
        )

    def link_taxonomy(self, dry_run: bool = False) -> dict[str, int]:
        """Run the DB auto-linkers: claims -> taxonomy nodes (exact -> alias -> fuzzy).

        Only processes claims without an existing link, so it is incremental and
        safe to run after every batch or as a full-corpus backfill.
        """
        counts: dict[str, int] = {}
        for label, function in (
            ("components", "knowledge.link_component_claims"),
            ("failure_modes", "knowledge.link_failure_mode_claims"),
        ):
            row = self._connection().execute(
                f"select count(*) as linked from {function}(%(dry_run)s)",
                {"dry_run": dry_run},
            ).fetchone()
            counts[label] = int(row["linked"])
        return counts

    def _connection(self) -> psycopg.Connection[dict[str, Any]]:
        if self.connection is None:
            raise RuntimeError("Repository must be used as a context manager.")
        return self.connection


def input_hash_for(title: str, abstract: str | None) -> str:
    payload = json.dumps({"title": title, "abstract": abstract or ""}, sort_keys=True)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def paper_from_candidate(candidate: CandidatePaper) -> Paper:
    return Paper(
        id=candidate.id,
        doi=candidate.doi,
        title=candidate.title,
        abstract=candidate.abstract,
        journal=candidate.journal,
        year=candidate.publication_year,
        authors=json.dumps(candidate.authors),
        url=candidate.source_url,
        source=candidate.source,
    )


def _authors_json(authors: str | None) -> str:
    if not authors:
        return "[]"
    parts = [part.strip() for part in authors.replace(";", ",").split(",") if part.strip()]
    return json.dumps(parts)
