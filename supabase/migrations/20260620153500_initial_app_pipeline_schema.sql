create schema if not exists app;
create schema if not exists papers_raw;
create schema if not exists knowledge;

create extension if not exists pgcrypto with schema extensions;

create or replace function app.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists app.user_accounts (
  id uuid primary key default gen_random_uuid(),
  clerk_user_id text not null unique,
  email text,
  first_name text,
  last_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger set_user_accounts_updated_at
before update on app.user_accounts
for each row execute function app.set_updated_at();

create table if not exists app.billing_customers (
  id uuid primary key default gen_random_uuid(),
  user_account_id uuid not null references app.user_accounts(id) on delete cascade,
  mollie_customer_id text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger set_billing_customers_updated_at
before update on app.billing_customers
for each row execute function app.set_updated_at();

create table if not exists app.billing_payments (
  id uuid primary key default gen_random_uuid(),
  user_account_id uuid references app.user_accounts(id) on delete set null,
  mollie_payment_id text not null unique,
  status text not null,
  amount_value numeric(12, 2) not null,
  amount_currency text not null default 'EUR',
  checkout_url text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists billing_payments_user_account_id_idx
on app.billing_payments(user_account_id);

create trigger set_billing_payments_updated_at
before update on app.billing_payments
for each row execute function app.set_updated_at();

create table if not exists papers_raw.discovery_runs (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  query text not null,
  status text not null default 'queued',
  started_at timestamptz,
  finished_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists papers_raw.paper_candidates (
  id uuid primary key default gen_random_uuid(),
  discovery_run_id uuid references papers_raw.discovery_runs(id) on delete set null,
  doi text,
  title text not null,
  abstract text,
  authors jsonb not null default '[]'::jsonb,
  journal text,
  publisher text,
  publication_year integer,
  source_url text,
  source text not null,
  raw_payload jsonb not null default '{}'::jsonb,
  classification_status text not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (doi)
);

create index if not exists paper_candidates_classification_status_idx
on papers_raw.paper_candidates(classification_status);

create index if not exists paper_candidates_title_idx
on papers_raw.paper_candidates using gin (to_tsvector('english', title));

create trigger set_paper_candidates_updated_at
before update on papers_raw.paper_candidates
for each row execute function app.set_updated_at();

create table if not exists knowledge.paper_classifications (
  id uuid primary key default gen_random_uuid(),
  paper_candidate_id uuid not null references papers_raw.paper_candidates(id) on delete cascade,
  relevance text not null,
  confidence numeric(5, 4),
  model_name text,
  model_version text,
  classifier_metadata jsonb not null default '{}'::jsonb,
  review_status text not null default 'machine_classified',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists paper_classifications_paper_candidate_id_idx
on knowledge.paper_classifications(paper_candidate_id);

create trigger set_paper_classifications_updated_at
before update on knowledge.paper_classifications
for each row execute function app.set_updated_at();

create table if not exists knowledge.evidence_records (
  id uuid primary key default gen_random_uuid(),
  paper_classification_id uuid not null references knowledge.paper_classifications(id) on delete cascade,
  component text,
  failure_mode text,
  cause text,
  effect text,
  control text,
  operating_context jsonb not null default '{}'::jsonb,
  evidence_span text,
  citation jsonb not null default '{}'::jsonb,
  confidence numeric(5, 4),
  review_status text not null default 'needs_review',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists evidence_records_component_idx
on knowledge.evidence_records(component);

create index if not exists evidence_records_failure_mode_idx
on knowledge.evidence_records(failure_mode);

create trigger set_evidence_records_updated_at
before update on knowledge.evidence_records
for each row execute function app.set_updated_at();

alter table app.user_accounts enable row level security;
alter table app.billing_customers enable row level security;
alter table app.billing_payments enable row level security;
alter table papers_raw.discovery_runs enable row level security;
alter table papers_raw.paper_candidates enable row level security;
alter table knowledge.paper_classifications enable row level security;
alter table knowledge.evidence_records enable row level security;
