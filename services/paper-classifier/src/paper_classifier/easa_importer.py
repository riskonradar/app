from __future__ import annotations

import json
import os
from typing import Any

import psycopg
from psycopg.rows import dict_row


def import_easa_ads(limit: int | None = None, dry_run: bool = False) -> int:
    database_url = os.environ.get("DATABASE_URL") or os.environ.get("SUPABASE_DB_URL")
    if not database_url:
        raise RuntimeError("Set DATABASE_URL or SUPABASE_DB_URL.")

    with psycopg.connect(database_url, row_factory=dict_row, autocommit=True) as conn:
        query = "select * from public.easa_ads where summary_text is not null and summary_text != ''"
        if limit:
            query += f" limit {limit}"
        ads = conn.execute(query).fetchall()

        if dry_run:
            print(f"Would import {len(ads)} EASA ADs (dry run).")
            for ad in ads[:3]:
                print(f"  {ad['ad_number']}: {ad['title'][:70]}")
            return len(ads)

        run_id = conn.execute(
            """
            insert into papers_raw.discovery_runs (source, query, status, started_at, metadata)
            values ('easa_ad', 'public.easa_ads import', 'running', now(), '{}'::jsonb)
            returning id
            """
        ).fetchone()["id"]

        count = 0
        for ad in ads:
            abstract = _build_abstract(ad)
            if not abstract:
                continue

            doi = f"easa-ad:{ad['ad_number']}"
            year = ad["issue_date"].year if ad.get("issue_date") else None

            conn.execute(
                """
                insert into papers_raw.paper_candidates (
                  discovery_run_id, doi, canonical_doi, title, title_fingerprint,
                  abstract, abstract_hash, authors, first_author,
                  journal, publication_year, source_url, source, external_ids,
                  lifecycle_status, classification_status, first_seen_at, last_seen_at,
                  stale_at, removed_at, discovery_score, discovery_metadata, raw_payload
                )
                values (
                  %(run_id)s,
                  %(doi)s,
                  nullif(lower(%(doi)s), ''),
                  %(title)s,
                  nullif(regexp_replace(extensions.unaccent(lower(%(title)s)), '[^a-z0-9]+', '', 'g'), ''),
                  %(abstract)s,
                  case
                    when %(abstract)s is null or trim(%(abstract)s) = '' then null
                    else encode(sha256(convert_to(trim(regexp_replace(extensions.unaccent(lower(%(abstract)s)), '\\s+', ' ', 'g')), 'utf8')), 'hex')
                  end,
                  '[]'::jsonb,
                  null,
                  %(journal)s,
                  %(year)s,
                  %(url)s,
                  'easa_ad',
                  %(external_ids)s::jsonb,
                  'pending_classification',
                  'pending',
                  now(),
                  now(),
                  null,
                  null,
                  0.85,
                  '{"importer": "easa_ad"}'::jsonb,
                  %(payload)s::jsonb
                )
                on conflict (doi) do update set
                  title = excluded.title,
                  title_fingerprint = excluded.title_fingerprint,
                  abstract = excluded.abstract,
                  abstract_hash = excluded.abstract_hash,
                  last_seen_at = now(),
                  stale_at = null,
                  removed_at = null,
                  external_ids = papers_raw.paper_candidates.external_ids || excluded.external_ids,
                  discovery_score = greatest(coalesce(papers_raw.paper_candidates.discovery_score, 0), excluded.discovery_score),
                  discovery_metadata = papers_raw.paper_candidates.discovery_metadata || excluded.discovery_metadata,
                  raw_payload = papers_raw.paper_candidates.raw_payload || excluded.raw_payload,
                  lifecycle_status = case
                    when papers_raw.paper_candidates.abstract is distinct from excluded.abstract
                    then 'pending_classification'
                    when papers_raw.paper_candidates.lifecycle_status in ('stale', 'removed')
                      and papers_raw.paper_candidates.classification_status = 'classified'
                    then 'classified'
                    when papers_raw.paper_candidates.lifecycle_status in ('stale', 'removed')
                    then 'pending_classification'
                    else papers_raw.paper_candidates.lifecycle_status
                  end,
                  classification_status = case
                    when papers_raw.paper_candidates.abstract is distinct from excluded.abstract
                    then 'pending'
                    else papers_raw.paper_candidates.classification_status
                  end
                """,
                {
                    "run_id": run_id,
                    "doi": doi,
                    "title": ad["title"],
                    "abstract": abstract,
                    "journal": "EASA Airworthiness Directive",
                    "year": year,
                    "url": ad.get("ad_url"),
                    "external_ids": json.dumps({"easa_ad": ad["ad_number"]}),
                    "payload": json.dumps({
                        "ad_number": ad["ad_number"],
                        "engine_family": ad.get("engine_family"),
                        "engine_models": ad.get("engine_models"),
                        "ata_chapter": ad.get("ata_chapter"),
                        "approval_holder": ad.get("approval_holder"),
                        "issue_date": str(ad["issue_date"]) if ad.get("issue_date") else None,
                        "effective_date": str(ad["effective_date"]) if ad.get("effective_date") else None,
                        "source_category": ad.get("source_category"),
                        "keyword": ad.get("keyword"),
                    }),
                },
            )
            count += 1

        conn.execute(
            """
            update papers_raw.discovery_runs
            set status = 'finished', finished_at = now(),
                metadata = jsonb_set(metadata, '{papers_found}', %(n)s::text::jsonb)
            where id = %(id)s
            """,
            {"n": count, "id": run_id},
        )

    return count


def _build_abstract(ad: dict[str, Any]) -> str | None:
    parts: list[str] = []

    summary = (ad.get("summary_text") or "").strip()
    if summary:
        parts.append(summary)

    required = (ad.get("required_actions") or "").strip()
    if required:
        parts.append(f"Required actions: {required}")

    engine = ad.get("engine_family") or ""
    models = ad.get("engine_models") or []
    ata = ad.get("ata_chapter") or ""
    if engine or models or ata:
        meta = f"Engine family: {engine}. ATA chapter: {ata}."
        if models:
            meta += f" Affected models: {', '.join(models[:5])}{'...' if len(models) > 5 else ''}."
        parts.append(meta)

    return "\n\n".join(parts) if parts else None
