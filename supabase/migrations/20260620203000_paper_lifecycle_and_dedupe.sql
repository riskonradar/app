create extension if not exists unaccent with schema extensions;

alter table papers_raw.paper_candidates
  add column if not exists canonical_doi text,
  add column if not exists title_fingerprint text,
  add column if not exists abstract_hash text,
  add column if not exists external_ids jsonb not null default '{}'::jsonb,
  add column if not exists first_author text,
  add column if not exists lifecycle_status text not null default 'pending_classification',
  add column if not exists first_seen_at timestamptz not null default now(),
  add column if not exists last_seen_at timestamptz not null default now(),
  add column if not exists stale_at timestamptz,
  add column if not exists removed_at timestamptz,
  add column if not exists discovery_score numeric(6, 4),
  add column if not exists discovery_metadata jsonb not null default '{}'::jsonb;

alter table papers_raw.paper_candidates
  drop constraint if exists paper_candidates_lifecycle_status_check;

alter table papers_raw.paper_candidates
  add constraint paper_candidates_lifecycle_status_check
  check (lifecycle_status in ('discovered', 'pending_classification', 'classified', 'stale', 'removed'));

update papers_raw.paper_candidates
set
  canonical_doi = nullif(
    lower(
      regexp_replace(
        regexp_replace(coalesce(doi, ''), '^https?://(dx\.)?doi\.org/', '', 'i'),
        '^doi:\s*',
        '',
        'i'
      )
    ),
    ''
  ),
  title_fingerprint = nullif(regexp_replace(extensions.unaccent(lower(coalesce(title, ''))), '[^a-z0-9]+', '', 'g'), ''),
  abstract_hash = case
    when abstract is null or trim(abstract) = '' then null
    else encode(sha256(convert_to(trim(regexp_replace(extensions.unaccent(lower(abstract)), '\s+', ' ', 'g')), 'utf8')), 'hex')
  end,
  first_author = nullif(trim(regexp_replace(extensions.unaccent(lower(authors ->> 0)), '\s+', ' ', 'g')), ''),
  lifecycle_status = case
    when classification_status = 'classified' then 'classified'
    else 'pending_classification'
  end
where canonical_doi is null
   or title_fingerprint is null
   or abstract_hash is null
   or first_author is null;

create index if not exists paper_candidates_canonical_doi_idx
on papers_raw.paper_candidates(canonical_doi)
where canonical_doi is not null;

create index if not exists paper_candidates_title_fingerprint_year_idx
on papers_raw.paper_candidates(title_fingerprint, publication_year)
where title_fingerprint is not null;

create index if not exists paper_candidates_abstract_hash_idx
on papers_raw.paper_candidates(abstract_hash)
where abstract_hash is not null;

create index if not exists paper_candidates_lifecycle_status_idx
on papers_raw.paper_candidates(lifecycle_status);

create index if not exists paper_candidates_last_seen_at_idx
on papers_raw.paper_candidates(last_seen_at);
