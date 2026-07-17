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

from paper_classifier.full_text import FullTextCandidate, FullTextFetchResult
from paper_classifier.keywords import KeywordTerm
from paper_classifier.models import ClassificationResult, ClaimType, Paper


TAXONOMY_LINKERS: tuple[tuple[str, str], ...] = (
    ("components", "knowledge.link_component_claims"),
    ("failure_modes", "knowledge.link_failure_mode_claims"),
    ("analysis_methods", "knowledge.link_analysis_method_claims"),
    ("applications", "knowledge.link_application_claims"),
)
MAX_REASONING_COMPONENT_ROOTS = 5_000


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
    full_text_id: str | None = None
    full_text: str | None = None
    full_text_source_url: str | None = None
    full_text_license: str | None = None
    full_text_sha256: str | None = None


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
            select
              pc.id,
              pc.doi,
              pc.title,
              pc.abstract,
              pc.journal,
              pc.publication_year,
              pc.authors,
              pc.source_url,
              pc.source,
              ft.id as full_text_id,
              ft.extracted_text as full_text,
              ft.resolved_url as full_text_source_url,
              ft.license as full_text_license,
              ft.content_sha256 as full_text_sha256
            from papers_raw.paper_candidates pc
            left join lateral (
              select pft.id, pft.extracted_text, pft.resolved_url, pft.license, pft.content_sha256
              from papers_raw.paper_full_texts pft
              where pft.paper_candidate_id = pc.id
                and pft.retrieval_status = 'fetched'
              order by pft.retrieved_at desc, pft.id desc
              limit 1
            ) ft on true
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
                full_text_id=str(row["full_text_id"]) if row["full_text_id"] else None,
                full_text=row["full_text"],
                full_text_source_url=row["full_text_source_url"],
                full_text_license=row["full_text_license"],
                full_text_sha256=row["full_text_sha256"],
            )
            for row in rows
        ]

    def active_taxonomy_terms(self) -> tuple[KeywordTerm, ...]:
        """Load the closed fallback vocabulary from the database in one query."""
        rows = self._connection().execute(
            """
            select claim_type, name, aliases, depth
            from (
              select 1 as claim_order, 'component'::text as claim_type, name, aliases, depth
              from knowledge.components
              where is_active = true
              union all
              select 2, 'failure_mode'::text, name, aliases, depth
              from knowledge.failure_modes
              where is_active = true
              union all
              select 3, 'analysis_method'::text, name, aliases, depth
              from knowledge.analysis_methods
              where is_active = true
              union all
              select 4, 'application'::text, name, aliases, depth
              from knowledge.applications
              where is_active = true
            ) active_taxonomy
            order by claim_order, lower(name), name
            """
        ).fetchall()

        terms: list[KeywordTerm] = []
        for row in rows:
            aliases: dict[str, str] = {}
            for value in (row["name"], *(row["aliases"] or [])):
                cleaned = str(value).strip()
                if cleaned:
                    aliases.setdefault(cleaned.casefold(), cleaned)
            terms.append(
                KeywordTerm(
                    normalized=str(row["name"]),
                    aliases=tuple(
                        sorted(
                            aliases.values(),
                            key=lambda value: (-len(value), value.casefold()),
                        )
                    ),
                    claim_type=ClaimType(row["claim_type"]),
                    depth=int(row["depth"]),
                )
            )
        return tuple(terms)

    def full_text_candidates(self, limit: int, retry_failed: bool = False) -> list[FullTextCandidate]:
        """Return OA candidates not yet terminally handled for their current URL."""
        rows = self._connection().execute(
            """
            select
              pc.id,
              pc.discovery_metadata->>'oa_url' as oa_url,
              pc.discovery_metadata->>'oa_status' as oa_status,
              pc.discovery_metadata->>'oa_license' as oa_license,
              pc.discovery_metadata->>'oa_license_url' as oa_license_url
            from papers_raw.paper_candidates pc
            where coalesce(pc.lifecycle_status, 'pending_classification') not in ('stale', 'removed')
              and coalesce((pc.discovery_metadata->>'is_oa')::boolean, false)
              and nullif(pc.discovery_metadata->>'oa_url', '') is not null
              and not exists (
                select 1
                from papers_raw.paper_full_texts pft
                where pft.paper_candidate_id = pc.id
                  and pft.source_url = pc.discovery_metadata->>'oa_url'
                  and coalesce(pft.license, '') = coalesce(pc.discovery_metadata->>'oa_license', '')
                  and (
                    pft.retrieval_status in ('fetched', 'rejected')
                    or (pft.retrieval_status = 'failed' and not %(retry_failed)s)
                  )
              )
              and (
                not %(retry_failed)s
                or (
                  select count(*)
                  from papers_raw.paper_full_texts failed_attempt
                  where failed_attempt.paper_candidate_id = pc.id
                    and failed_attempt.source_url = pc.discovery_metadata->>'oa_url'
                    and coalesce(failed_attempt.license, '') = coalesce(pc.discovery_metadata->>'oa_license', '')
                    and failed_attempt.retrieval_status = 'failed'
                ) < 3
              )
            order by pc.publication_year desc nulls last, pc.id
            limit %(limit)s
            """,
            {"limit": limit, "retry_failed": retry_failed},
        ).fetchall()
        return [
            FullTextCandidate(
                paper_candidate_id=str(row["id"]),
                source_url=row["oa_url"],
                oa_status=row["oa_status"],
                license=row["oa_license"],
                license_url=row["oa_license_url"],
            )
            for row in rows
        ]

    def save_full_text_result(
        self,
        candidate: FullTextCandidate,
        result: FullTextFetchResult,
    ) -> str:
        row = self._connection().execute(
            """
            insert into papers_raw.paper_full_texts (
              paper_candidate_id,
              source_url,
              resolved_url,
              oa_status,
              license,
              license_url,
              retrieval_status,
              rejection_reason,
              http_status,
              content_type,
              content_bytes,
              content_sha256,
              extracted_text,
              extraction_method,
              metadata
            )
            values (
              %(paper_candidate_id)s,
              %(source_url)s,
              %(resolved_url)s,
              %(oa_status)s,
              %(license)s,
              %(license_url)s,
              %(retrieval_status)s,
              %(rejection_reason)s,
              %(http_status)s,
              %(content_type)s,
              %(content_bytes)s,
              %(content_sha256)s,
              %(extracted_text)s,
              %(extraction_method)s,
              %(metadata)s::jsonb
            )
            returning id
            """,
            {
                "paper_candidate_id": candidate.paper_candidate_id,
                "source_url": candidate.source_url,
                "resolved_url": result.resolved_url,
                "oa_status": candidate.oa_status,
                "license": candidate.license,
                "license_url": candidate.license_url,
                "retrieval_status": result.status,
                "rejection_reason": result.reason,
                "http_status": result.http_status,
                "content_type": result.content_type,
                "content_bytes": result.content_bytes,
                "content_sha256": result.content_sha256,
                "extracted_text": result.extracted_text,
                "extraction_method": result.extraction_method,
                "metadata": json.dumps(result.metadata),
            },
        ).fetchone()
        if result.status == "fetched":
            self._connection().execute(
                """
                update papers_raw.paper_candidates
                set classification_status = 'pending',
                    lifecycle_status = 'pending_classification'
                where id = %(paper_candidate_id)s
                  and coalesce(lifecycle_status, 'pending_classification') not in ('stale', 'removed')
                """,
                {"paper_candidate_id": candidate.paper_candidate_id},
            )
        return str(row["id"])

    def evaluation_candidates(self, limit: int) -> list[CandidatePaper]:
        """Deterministic, source-interleaved sample for model evaluation export."""
        rows = self._connection().execute(
            """
            with candidates as (
              select
                pc.id,
                pc.doi,
                pc.title,
                pc.abstract,
                pc.journal,
                pc.publication_year,
                pc.authors,
                pc.source_url,
                pc.source,
                ft.id as full_text_id,
                ft.extracted_text as full_text,
                ft.resolved_url as full_text_source_url,
                ft.license as full_text_license,
                ft.content_sha256 as full_text_sha256,
                row_number() over (
                  partition by pc.source
                  order by md5(pc.id::text)
                ) as source_rank
              from papers_raw.paper_candidates pc
              left join lateral (
                select pft.id, pft.extracted_text, pft.resolved_url, pft.license, pft.content_sha256
                from papers_raw.paper_full_texts pft
                where pft.paper_candidate_id = pc.id
                  and pft.retrieval_status = 'fetched'
                order by pft.retrieved_at desc, pft.id desc
                limit 1
              ) ft on true
              where coalesce(pc.lifecycle_status, 'pending_classification') not in ('stale', 'removed')
                and (nullif(pc.abstract, '') is not null or ft.id is not null)
            )
            select *
            from candidates
            order by source_rank, source, md5(id::text)
            limit %(limit)s
            """,
            {"limit": limit},
        ).fetchall()
        return [_candidate_from_row(row) for row in rows]

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

        input_hash = input_hash_for(candidate.title, candidate.abstract, candidate.full_text_sha256 or candidate.full_text)
        with self._connection().transaction():
            job_row = self._connection().execute(
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
                where knowledge.classification_jobs.status <> 'completed'
                returning id
                """,
                {
                    "paper_candidate_id": candidate.id,
                    "input_hash": input_hash,
                    "classifier_version": classifier_version,
                    "mode": mode,
                    "metadata": json.dumps(result.metadata),
                },
            ).fetchone()

            # A completed (paper, input, classifier) job is immutable. This also
            # makes concurrent workers and explicit replays idempotent without
            # deleting claims that may already have been reviewed or cited.
            if job_row is None:
                return
            job_id = job_row["id"]

            # Supersede unreviewed claims from earlier jobs for this paper instead of
            # deleting them: preserves human review state and FMEA evidence links.
            self._connection().execute(
                """
                update knowledge.evidence_claims
                set review_status = 'superseded'
                where paper_candidate_id = %(paper_candidate_id)s
                  and classification_job_id <> %(job_id)s
                  and review_status = 'needs_review'
                  and (
                    %(new_is_llm)s
                    or exists (
                      select 1
                      from knowledge.classification_jobs previous_job
                      where previous_job.id = knowledge.evidence_claims.classification_job_id
                        and coalesce(previous_job.classifier_metadata->>'extractor', '') <> 'llm'
                    )
                  )
                """,
                {
                    "paper_candidate_id": candidate.id,
                    "job_id": job_id,
                    "new_is_llm": result.metadata.get("extractor") == "llm",
                },
            )

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
                          license_safe,
                          full_text_id
                        )
                        values (
                          %(evidence_claim_id)s,
                          %(source_field)s,
                          %(text)s,
                          %(char_start)s,
                          %(char_end)s,
                          %(license_safe)s,
                          %(full_text_id)s
                        )
                        """,
                        {
                            "evidence_claim_id": claim_id,
                            "source_field": span.source_field,
                            "text": span.text,
                            "char_start": span.char_start,
                            "char_end": span.char_end,
                            "license_safe": span.license_safe,
                            "full_text_id": span.source_record_id,
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

    def reasoning_input(
        self,
        organization_id: str,
        asset_id: str,
        max_claims: int,
    ) -> dict[str, Any]:
        """Load one repeatable, tenant-scoped accepted graph for aggregate reasoning."""
        connection = self._connection()
        with connection.transaction():
            connection.execute("set transaction isolation level repeatable read, read only")
            asset = connection.execute(
                """
                select id, organization_id, name, asset_type, operating_context
                from app.assets
                where id = %(asset_id)s
                  and organization_id = %(organization_id)s
                  and metadata @> '{"system_model":true}'::jsonb
                """,
                {"organization_id": organization_id, "asset_id": asset_id},
            ).fetchone()
            if asset is None:
                return {"asset": None}

            instances = connection.execute(
                """
                select instance.id, instance.parent_instance_id,
                       instance.component_id as component_taxonomy_id,
                       component.name as component_taxonomy_name,
                       component.path as component_taxonomy_path,
                       instance.name, instance.instance_key, instance.node_kind,
                       instance.function_text, instance.criticality
                from app.asset_component_instances instance
                join knowledge.components component on component.id = instance.component_id
                where instance.organization_id = %(organization_id)s
                  and instance.asset_id = %(asset_id)s
                order by instance.id
                limit 251
                """,
                {"organization_id": organization_id, "asset_id": asset_id},
            ).fetchall()
            dependencies = connection.execute(
                """
                select id, source_instance_id, target_instance_id,
                       dependency_type, direction, name, description
                from app.asset_dependencies
                where organization_id = %(organization_id)s and asset_id = %(asset_id)s
                order by id
                limit 501
                """,
                {"organization_id": organization_id, "asset_id": asset_id},
            ).fetchall()
            propagations = connection.execute(
                """
                select propagation.id, propagation.source_instance_id,
                       propagation.target_instance_id,
                       propagation.source_failure_mode_id,
                       failure_mode.name as failure_mode_name,
                       propagation.target_effect, propagation.trigger_condition,
                       propagation.likelihood, propagation.confidence::float8 as confidence,
                       propagation.rationale, propagation.evidence_claim_id,
                       propagation.claim_relationship_id, propagation.evidence_span_id
                from app.asset_failure_propagations propagation
                join knowledge.failure_modes failure_mode
                  on failure_mode.id = propagation.source_failure_mode_id
                left join knowledge.evidence_claims propagation_claim
                  on propagation_claim.id = propagation.evidence_claim_id
                left join papers_raw.paper_candidates evidence_paper
                  on evidence_paper.id = propagation_claim.paper_candidate_id
                where propagation.organization_id = %(organization_id)s
                  and propagation.asset_id = %(asset_id)s
                  and propagation.review_status = 'accepted'
                  and (
                    propagation.evidence_claim_id is null
                    or evidence_paper.lifecycle_status <> 'removed'
                  )
                order by propagation.id
                limit 251
                """,
                {"organization_id": organization_id, "asset_id": asset_id},
            ).fetchall()
            propagation_relationship_ids = [
                str(row["claim_relationship_id"])
                for row in propagations
                if row["claim_relationship_id"] is not None
            ]
            claims = connection.execute(
                """
                with recursive system_component_paths as (
                  select distinct component.path
                  from app.asset_component_instances instance
                  join knowledge.components component on component.id = instance.component_id
                  where instance.organization_id = %(organization_id)s
                    and instance.asset_id = %(asset_id)s
                ),
                tenant_accepted_claims as (
                  select review.evidence_claim_id
                  from app.evidence_claim_reviews review
                  where review.organization_id = %(organization_id)s
                    and review.review_status = 'accepted'
                  union
                  select propagation.evidence_claim_id
                  from app.asset_failure_propagations propagation
                  left join knowledge.evidence_claims propagation_claim
                    on propagation_claim.id = propagation.evidence_claim_id
                  left join papers_raw.paper_candidates propagation_paper
                    on propagation_paper.id = propagation_claim.paper_candidate_id
                  where propagation.organization_id = %(organization_id)s
                    and propagation.asset_id = %(asset_id)s
                    and propagation.review_status = 'accepted'
                    and propagation.evidence_claim_id is not null
                    and propagation_paper.lifecycle_status <> 'removed'
                ),
                matched_component_roots as (
                  select distinct
                         component_claim.classification_job_id,
                         component_claim.id as claim_id
                  from knowledge.claim_component_links component_link
                  join knowledge.evidence_claims component_claim
                    on component_claim.id = component_link.evidence_claim_id
                    and component_claim.claim_type = 'component'
                    and component_claim.review_status not in ('rejected', 'superseded')
                  join knowledge.components evidence_component
                    on evidence_component.id = component_link.component_id
                  join knowledge.classification_jobs job
                    on job.id = component_claim.classification_job_id
                    and job.status = 'completed'
                    and job.classifier_metadata->>'extractor' = 'llm'
                  join papers_raw.paper_candidates root_paper
                    on root_paper.id = component_claim.paper_candidate_id
                    and root_paper.lifecycle_status <> 'removed'
                  where component_link.review_status != 'rejected'
                    and exists (
                      select 1 from system_component_paths system_component
                      where evidence_component.path = system_component.path
                         or evidence_component.path like system_component.path || '/%%'
                  )
                  order by component_claim.classification_job_id, component_claim.id
                  limit %(root_limit)s
                ),
                accepted_claim_closure (claim_id, classification_job_id, path, depth) as (
                  select root.claim_id, root.classification_job_id,
                         array[root.claim_id]::uuid[], 0
                  from matched_component_roots root
                  union all
                  select relationship.object_claim_id, closure.classification_job_id,
                         closure.path || relationship.object_claim_id,
                         closure.depth + 1
                  from accepted_claim_closure closure
                  join knowledge.claim_relationships relationship
                    on relationship.subject_claim_id = closure.claim_id
                    and relationship.classification_job_id = closure.classification_job_id
                    and (
                      relationship.review_status = 'accepted'
                      or relationship.id = any(%(propagation_relationship_ids)s::uuid[])
                    )
                  join papers_raw.paper_candidates relationship_paper
                    on relationship_paper.id = relationship.paper_candidate_id
                    and relationship_paper.lifecycle_status <> 'removed'
                  where closure.depth < 6
                    and not relationship.object_claim_id = any(closure.path)
                ),
                relevant_accepted_claims as (
                  select distinct closure.claim_id
                  from accepted_claim_closure closure
                  join tenant_accepted_claims accepted
                    on accepted.evidence_claim_id = closure.claim_id
                )
                select claim.id, claim.claim_type, claim.normalized_value as value,
                       claim.confidence::float8 as confidence, claim.support_type,
                       claim.paper_candidate_id, paper.title as source_title,
                       paper.doi, coalesce(spans.items, '[]'::jsonb) as spans
                from relevant_accepted_claims accepted
                join knowledge.evidence_claims claim on claim.id = accepted.claim_id
                join knowledge.classification_jobs job on job.id = claim.classification_job_id
                  and job.status = 'completed'
                  and job.classifier_metadata->>'extractor' = 'llm'
                join papers_raw.paper_candidates paper
                  on paper.id = claim.paper_candidate_id
                  and paper.lifecycle_status <> 'removed'
                left join lateral (
                  select jsonb_agg(jsonb_build_object(
                    'id', selected_span.id,
                    'source_field', selected_span.source_field,
                    'text', selected_span.text,
                    'char_start', selected_span.char_start,
                    'char_end', selected_span.char_end
                  ) order by selected_span.id) as items
                  from (
                    select span.id, span.source_field, span.text, span.char_start, span.char_end
                    from knowledge.evidence_spans span
                    where span.evidence_claim_id = claim.id and span.license_safe = true
                    order by span.id
                    limit 3
                  ) selected_span
                ) spans on true
                where claim.review_status not in ('rejected', 'superseded')
                order by claim.id
                limit %(claim_limit)s
                """,
                {
                    "organization_id": organization_id,
                    "asset_id": asset_id,
                    "claim_limit": max_claims + 1,
                    "root_limit": MAX_REASONING_COMPONENT_ROOTS + 1,
                    "propagation_relationship_ids": propagation_relationship_ids,
                },
            ).fetchall()
            claim_ids = [str(row["id"]) for row in claims]
            relationships: list[dict[str, Any]] = []
            if claim_ids:
                relationships = connection.execute(
                    """
                    select relationship.id, relationship.subject_claim_id,
                           relationship.relationship_type, relationship.object_claim_id,
                           relationship.confidence::float8 as confidence,
                           relationship.support_type
                    from knowledge.claim_relationships relationship
                    join papers_raw.paper_candidates paper
                      on paper.id = relationship.paper_candidate_id
                      and paper.lifecycle_status <> 'removed'
                    where relationship.subject_claim_id = any(%(claim_ids)s::uuid[])
                      and relationship.object_claim_id = any(%(claim_ids)s::uuid[])
                      and (
                        relationship.review_status = 'accepted'
                        or relationship.id = any(%(propagation_relationship_ids)s::uuid[])
                      )
                    order by relationship.id
                    limit 1001
                    """,
                    {
                        "claim_ids": claim_ids,
                        "propagation_relationship_ids": propagation_relationship_ids,
                    },
                ).fetchall()

        return {
            "asset": asset,
            "system_instances": instances,
            "dependencies": dependencies,
            "accepted_propagations": propagations,
            "accepted_evidence_claims": claims,
            "accepted_evidence_relationships": relationships,
        }

    def claim_reasoning_job(
        self,
        manifest: Any,
        config: Any,
        retry_failed: bool,
    ) -> dict[str, Any]:
        params = {
            "organization_id": manifest.payload["organization_id"],
            "asset_id": manifest.payload["asset"]["id"],
            "input_hash": manifest.input_hash,
            "input_manifest": manifest.canonical_json,
            "manifest_version": manifest.payload["manifest_version"],
            "prompt_version": manifest.prompt_version,
            "provider": config.provider,
            "model": config.model,
        }
        connection = self._connection()
        with connection.transaction():
            inserted = connection.execute(
                """
                insert into app.reasoning_jobs (
                  organization_id, asset_id, input_hash, input_manifest,
                  manifest_version, prompt_version, provider, model, status,
                  lease_expires_at
                ) values (
                  %(organization_id)s, %(asset_id)s, %(input_hash)s,
                  %(input_manifest)s::jsonb, %(manifest_version)s,
                  %(prompt_version)s, %(provider)s, %(model)s, 'running',
                  now() + interval '15 minutes'
                )
                on conflict (organization_id, asset_id, input_hash, prompt_version, provider, model)
                do nothing
                returning id, status, attempts
                """,
                params,
            ).fetchone()
            if inserted:
                return {
                    "id": str(inserted["id"]),
                    "status": "running",
                    "attempts": inserted["attempts"],
                    "should_run": True,
                }

            reclaimed = connection.execute(
                """
                update app.reasoning_jobs
                set attempts = attempts + 1, started_at = now(),
                    lease_expires_at = now() + interval '15 minutes',
                    completed_at = null, last_error = null
                where organization_id = %(organization_id)s
                  and asset_id = %(asset_id)s
                  and input_hash = %(input_hash)s
                  and prompt_version = %(prompt_version)s
                  and provider = %(provider)s and model = %(model)s
                  and status = 'running' and lease_expires_at <= now()
                  and attempts < 3
                returning id, status, attempts
                """,
                params,
            ).fetchone()
            if reclaimed:
                return {
                    "id": str(reclaimed["id"]),
                    "status": "running",
                    "attempts": reclaimed["attempts"],
                    "should_run": True,
                }

            exhausted = connection.execute(
                """
                update app.reasoning_jobs
                set status = 'failed', completed_at = now(), lease_expires_at = null,
                    last_error = 'Reasoning job lease expired after 3 attempts.'
                where organization_id = %(organization_id)s
                  and asset_id = %(asset_id)s
                  and input_hash = %(input_hash)s
                  and prompt_version = %(prompt_version)s
                  and provider = %(provider)s and model = %(model)s
                  and status = 'running' and lease_expires_at <= now()
                  and attempts >= 3
                returning id, status, attempts
                """,
                params,
            ).fetchone()
            if exhausted:
                return {
                    "id": str(exhausted["id"]),
                    "status": "failed",
                    "attempts": exhausted["attempts"],
                    "should_run": False,
                }

            if retry_failed:
                retried = connection.execute(
                    """
                    update app.reasoning_jobs
                    set status = 'running', attempts = attempts + 1,
                        started_at = now(),
                        lease_expires_at = now() + interval '15 minutes',
                        completed_at = null, last_error = null
                    where organization_id = %(organization_id)s
                      and asset_id = %(asset_id)s
                      and input_hash = %(input_hash)s
                      and prompt_version = %(prompt_version)s
                      and provider = %(provider)s and model = %(model)s
                      and status = 'failed' and attempts < 3
                    returning id, status, attempts
                    """,
                    params,
                ).fetchone()
                if retried:
                    return {
                        "id": str(retried["id"]),
                        "status": "running",
                        "attempts": retried["attempts"],
                        "should_run": True,
                    }

            existing = connection.execute(
                """
                select id, status, attempts from app.reasoning_jobs
                where organization_id = %(organization_id)s
                  and asset_id = %(asset_id)s and input_hash = %(input_hash)s
                  and prompt_version = %(prompt_version)s
                  and provider = %(provider)s and model = %(model)s
                """,
                params,
            ).fetchone()
            if existing is None:
                raise RuntimeError("Reasoning job conflict could not be resolved.")
            return {
                "id": str(existing["id"]),
                "status": existing["status"],
                "attempts": existing["attempts"],
                "should_run": False,
            }

    def complete_reasoning_job(
        self,
        job_id: str,
        attempt: int,
        suggestions: list[dict[str, Any]],
    ) -> None:
        connection = self._connection()
        with connection.transaction():
            job = connection.execute(
                """
                select organization_id, asset_id
                from app.reasoning_jobs
                where id = %(id)s and status = 'running' and attempts = %(attempt)s
                for update
                """,
                {"id": job_id, "attempt": attempt},
            ).fetchone()
            if job is None:
                raise RuntimeError("Reasoning job lease is no longer owned by this attempt.")
            for suggestion in suggestions:
                connection.execute(
                    """
                    insert into app.reasoning_suggestions (
                      reasoning_job_id, organization_id, asset_id, suggestion_key,
                      suggestion_type, title, summary, rationale, confidence,
                      system_instance_ids, evidence_claim_ids,
                      evidence_relationship_ids, failure_propagation_ids
                    ) values (
                      %(reasoning_job_id)s, %(organization_id)s, %(asset_id)s,
                      %(suggestion_key)s, %(suggestion_type)s, %(title)s,
                      %(summary)s, %(rationale)s, %(confidence)s,
                      %(system_instance_ids)s::uuid[], %(evidence_claim_ids)s::uuid[],
                      %(evidence_relationship_ids)s::uuid[], %(failure_propagation_ids)s::uuid[]
                    ) on conflict (reasoning_job_id, suggestion_key) do nothing
                    """,
                    {**suggestion, "reasoning_job_id": job_id, **job},
                )
            connection.execute(
                """
                update app.reasoning_jobs
                set status = 'completed', completed_at = now(), last_error = null,
                    lease_expires_at = null,
                    metadata = jsonb_build_object('suggestion_count', %(suggestion_count)s)
                where id = %(id)s and status = 'running' and attempts = %(attempt)s
                """,
                {
                    "id": job_id,
                    "attempt": attempt,
                    "suggestion_count": len(suggestions),
                },
            )

    def fail_reasoning_job(self, job_id: str, attempt: int, error: str) -> None:
        self._connection().execute(
            """
            update app.reasoning_jobs
            set status = 'failed', completed_at = now(), lease_expires_at = null,
                last_error = %(error)s
            where id = %(id)s and status = 'running' and attempts = %(attempt)s
            """,
            {"id": job_id, "attempt": attempt, "error": error[:2000]},
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
                "input_hash": input_hash_for(
                    candidate.title,
                    candidate.abstract,
                    candidate.full_text_sha256 or candidate.full_text,
                ),
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
        with self._connection().transaction():
            # Direct Postgres connections do not carry the Supabase JWT claim
            # checked by the service-role-only SECURITY DEFINER linkers.
            self._connection().execute(
                "select set_config('request.jwt.claim.role', 'service_role', true)"
            )
            for label, function in TAXONOMY_LINKERS:
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


def input_hash_for(title: str, abstract: str | None, full_text_fingerprint: str | None = None) -> str:
    payload = json.dumps(
        {
            "title": title,
            "abstract": abstract or "",
            "full_text_fingerprint": full_text_fingerprint or "",
        },
        sort_keys=True,
    )
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
        full_text=candidate.full_text,
        full_text_id=candidate.full_text_id,
        full_text_source_url=candidate.full_text_source_url,
        full_text_license=candidate.full_text_license,
        full_text_sha256=candidate.full_text_sha256,
    )


def _candidate_from_row(row: dict[str, Any]) -> CandidatePaper:
    return CandidatePaper(
        id=str(row["id"]),
        doi=row["doi"],
        title=row["title"],
        abstract=row["abstract"],
        journal=row["journal"],
        publication_year=row["publication_year"],
        authors=row["authors"] or [],
        source_url=row["source_url"],
        source=row["source"],
        full_text_id=str(row["full_text_id"]) if row["full_text_id"] else None,
        full_text=row["full_text"],
        full_text_source_url=row["full_text_source_url"],
        full_text_license=row["full_text_license"],
        full_text_sha256=row["full_text_sha256"],
    )


def _authors_json(authors: str | None) -> str:
    if not authors:
        return "[]"
    parts = [part.strip() for part in authors.replace(";", ",").split(",") if part.strip()]
    return json.dumps(parts)
