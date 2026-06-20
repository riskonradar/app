create table if not exists knowledge.classification_jobs (
  id uuid primary key default gen_random_uuid(),
  paper_candidate_id uuid not null references papers_raw.paper_candidates(id) on delete cascade,
  input_hash text not null,
  classifier_version text not null,
  mode text not null default 'incremental',
  status text not null default 'queued',
  attempts integer not null default 0,
  started_at timestamptz,
  completed_at timestamptz,
  last_error text,
  classifier_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (paper_candidate_id, input_hash, classifier_version),
  constraint classification_jobs_mode_check check (mode in ('backfill', 'incremental')),
  constraint classification_jobs_status_check check (status in ('queued', 'running', 'completed', 'failed', 'skipped'))
);

create index if not exists classification_jobs_paper_candidate_id_idx
on knowledge.classification_jobs(paper_candidate_id);

create index if not exists classification_jobs_status_idx
on knowledge.classification_jobs(status);

create trigger set_classification_jobs_updated_at
before update on knowledge.classification_jobs
for each row execute function app.set_updated_at();

create table if not exists knowledge.evidence_claims (
  id uuid primary key default gen_random_uuid(),
  paper_candidate_id uuid not null references papers_raw.paper_candidates(id) on delete cascade,
  classification_job_id uuid not null references knowledge.classification_jobs(id) on delete cascade,
  claim_type text not null,
  raw_value text not null,
  normalized_value text,
  support_type text not null,
  inference_rationale text,
  confidence numeric(5, 4),
  review_status text not null default 'needs_review',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint evidence_claims_claim_type_check check (
    claim_type in (
      'component',
      'failure_mode',
      'cause',
      'effect',
      'control',
      'operating_context',
      'detection_method',
      'maintenance_action',
      'material',
      'environment'
    )
  ),
  constraint evidence_claims_support_type_check check (support_type in ('direct_span', 'inferred_from_span')),
  constraint evidence_claims_review_status_check check (
    review_status in ('needs_review', 'accepted', 'edited', 'rejected', 'superseded')
  )
);

create index if not exists evidence_claims_paper_candidate_id_idx
on knowledge.evidence_claims(paper_candidate_id);

create index if not exists evidence_claims_classification_job_id_idx
on knowledge.evidence_claims(classification_job_id);

create index if not exists evidence_claims_claim_type_idx
on knowledge.evidence_claims(claim_type);

create index if not exists evidence_claims_normalized_value_idx
on knowledge.evidence_claims(normalized_value);

create trigger set_evidence_claims_updated_at
before update on knowledge.evidence_claims
for each row execute function app.set_updated_at();

create table if not exists knowledge.evidence_spans (
  id uuid primary key default gen_random_uuid(),
  evidence_claim_id uuid not null references knowledge.evidence_claims(id) on delete cascade,
  source_field text not null,
  text text not null,
  char_start integer,
  char_end integer,
  license_safe boolean not null default true,
  created_at timestamptz not null default now(),
  constraint evidence_spans_source_field_check check (source_field in ('title', 'abstract', 'full_text', 'metadata')),
  constraint evidence_spans_offsets_check check (
    char_start is null
    or char_end is null
    or (char_start >= 0 and char_end >= char_start)
  )
);

create index if not exists evidence_spans_evidence_claim_id_idx
on knowledge.evidence_spans(evidence_claim_id);

create table if not exists knowledge.claim_relationships (
  id uuid primary key default gen_random_uuid(),
  paper_candidate_id uuid not null references papers_raw.paper_candidates(id) on delete cascade,
  classification_job_id uuid not null references knowledge.classification_jobs(id) on delete cascade,
  subject_claim_id uuid not null references knowledge.evidence_claims(id) on delete cascade,
  relationship_type text not null,
  object_claim_id uuid not null references knowledge.evidence_claims(id) on delete cascade,
  support_type text not null,
  confidence numeric(5, 4),
  review_status text not null default 'needs_review',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint claim_relationships_relationship_type_check check (
    relationship_type in ('has_failure_mode', 'caused_by', 'has_effect', 'mitigated_by', 'detected_by', 'has_context')
  ),
  constraint claim_relationships_support_type_check check (support_type in ('direct_span', 'inferred_from_span')),
  constraint claim_relationships_review_status_check check (
    review_status in ('needs_review', 'accepted', 'edited', 'rejected', 'superseded')
  )
);

create index if not exists claim_relationships_paper_candidate_id_idx
on knowledge.claim_relationships(paper_candidate_id);

create index if not exists claim_relationships_classification_job_id_idx
on knowledge.claim_relationships(classification_job_id);

create index if not exists claim_relationships_subject_claim_id_idx
on knowledge.claim_relationships(subject_claim_id);

create index if not exists claim_relationships_object_claim_id_idx
on knowledge.claim_relationships(object_claim_id);

create trigger set_claim_relationships_updated_at
before update on knowledge.claim_relationships
for each row execute function app.set_updated_at();

alter table knowledge.classification_jobs enable row level security;
alter table knowledge.evidence_claims enable row level security;
alter table knowledge.evidence_spans enable row level security;
alter table knowledge.claim_relationships enable row level security;
