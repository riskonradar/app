# Risk on Radar App Repository

This repository is for the Risk on Radar application product, not the public marketing website.

Risk on Radar is a B2B engineering intelligence platform for reliability, failure detection, FMEA, root-cause analysis, predictive maintenance, and operational risk assessment. The product turns fragmented engineering failure evidence into adaptive reliability intelligence that engineers can use inside traceable reliability workflows.

## Source Material

Use these as project context before making product or UX decisions:

- Public website: https://riskonradar.com/
- Whitepaper: https://riskonradar.com/whitepaper.pdf
- Landing repository: https://github.com/riskonradar/landing

The landing repository and live website are for marketing, waitlist, public copy, SEO, and launch pages. This repository should contain the authenticated product application and supporting application services.

## Product Positioning

Risk on Radar is an evidence-backed FMEA intelligence platform for reliability and quality engineering teams. Its differentiator is not another blank-row FMEA editor — it is an external intelligence layer: a continuously updated failure knowledge graph built from peer-reviewed failure literature and structured engineering evidence (including regulatory sources like EASA airworthiness directives).

The app behaves as an engineering copilot, not an autopilot. It surfaces documented failure modes, causes, effects, controls, confidence signals, and citations so engineers can accept, edit, reject, and defend decisions. Human review and source traceability are core product requirements.

## Core Product Pillars

1. **Living Failure Knowledge Engine** — Continuously structures fragmented failure knowledge from scientific literature, regulatory documents, industrial reports, NDT investigations, standards, and validated internal sources. Normalizes evidence into typed atomic claims with source-anchored evidence spans.

2. **System-Level Risk Analysis** — Models assets as interconnected systems. Represents subsystem dependencies, interface failures, propagation paths, cascading failures, and system-wide vulnerabilities.

3. **Cross-Domain Failure Intelligence** — Finds transferable failure signatures across industries and operating contexts. Adapts source-domain knowledge to target environments rather than copying risk scores directly.

## Domain Concepts

Use consistent domain language:

- **Asset**: a physical engineering system or equipment item.
- **Component**: an engineering part (bearing, gearbox, blade, valve, seal, pump, shaft, weld, sensor, battery, converter).
- **Failure mode**: how a component or system fails (fatigue fracture, corrosion, wear, delamination, overheating, leakage).
- **Cause**: why the failure mode occurs (cyclic loading, poor lubrication, manufacturing defect, hydrogen embrittlement).
- **Effect**: consequence (engine shutdown, oil loss, fire, structural collapse, operational loss).
- **Control**: preventive measure (inspection interval, protective coating, redesign, lubrication schedule).
- **Corrective action**: reactive fix applied after a confirmed failure or unsafe condition (part replacement, mandatory modification, airworthiness directive compliance).
- **Analysis method**: investigation technique (FEA, SEM, probabilistic fatigue assessment, ML, experimental testing, simulation, fracture mechanics).
- **Application**: operating industry or domain (aviation, wind energy, oil and gas, automotive, nuclear, marine, mining).
- **Operating context**: specific operating conditions (offshore, turbofan at cruise, high temperature, cyclic loading).
- **Detection method**: how failure was found in service (visual inspection, vibration monitoring, borescope, ultrasonic testing).
- **Evidence span**: exact text quote from source with character offsets proving a claim.
- **FMEA row**: structured record containing component, function, failure mode, effect, severity, cause, occurrence, controls, detection, action priority, recommended action, and evidence lineage.

## Engineering Rules for Agents

- Read this file and `CLAUDE.md` before making substantial changes.
- Do not invent regulatory or standards compliance that has not been implemented.
- Do not hard-code paper counts or claim counts — read them from the DB.
- Prefer typed domain models for FMEA rows, evidence records, citations, confidence, review states.
- Keep AI content auditable: inputs, model/version, evidence references, timestamp, reviewer actions.
- Always schema-qualify DB queries: `papers_raw.paper_candidates`, `knowledge.evidence_claims`, etc.
- Never query `knowledge.evidence_records` — it is an empty legacy table, never populated.
- Never query `knowledge.paper_classifications` — legacy coarse summary, now empty after cleanup.
- Never hard-code an "active" provider/model. The code prefix is `llm-extractor-v5`;
  query completed `knowledge.classification_jobs` and its metadata for runtime truth.
- Do not change architecture or stack decisions without explicit user approval.

## Repository Architecture

```
apps/
  web/                    Next.js 16 product UI + API routes
services/
  paper-discovery/        Python: finds papers via OpenAlex, writes to papers_raw
  paper-classifier/       Python: reads pending papers, extracts claims, writes to knowledge
packages/
  shared/                 empty — shared types once contracts stabilize
supabase/
  migrations/             SQL migrations for all schemas
```

Package manager: pnpm. Workspace root is repo root. `pnpm-workspace.yaml` covers `apps/*`, `services/*`, `packages/*`.

---

## Supabase Database: Complete Reference

Supabase project: `https://rqzwdzhphxuayqwptqia.supabase.co`
Connection: use the session pooler — `aws-0-eu-west-1.pooler.supabase.com:5432` (the direct connection is IPv6-only on free tier).

### Schemas

- `app` — user accounts, billing customers, billing payments (Clerk mirror + Stripe state)
- `papers_raw` — raw discovery input: discovery runs and paper candidates
- `knowledge` — machine-extracted reliability intelligence: classification jobs, evidence claims, spans, relationships
- `public` — EASA ADs source table (`public.easa_ads`, original structured source)

All product tables use RLS. Server-side code must use appropriate credentials. An empty result from the API may mean an RLS policy issue, not missing data. The Supabase Table Editor defaults to `public`; switch the schema dropdown to see product tables.

---

### `papers_raw.discovery_runs`

One row per discovery or import run. Tracks provenance of how papers entered the system.

| Column | Type | Description |
|---|---|---|
| id | uuid | PK |
| source | text | `'corpus_backfill'`, `'zotero'`, `'easa_ad'`, `'openalex'` (`'crossref'` appears on historical rows; the source was removed 2026-07) |
| query | text | Search query or import description |
| status | text | `'running'`, `'finished'`, `'failed'` |
| started_at | timestamptz | |
| finished_at | timestamptz | |
| metadata | jsonb | `papers_found`, `error`, and other run-specific fields |

---

### `papers_raw.paper_candidates`

One row per unique paper or document. The source-of-record for all raw input before classification.

| Column | Type | Description |
|---|---|---|
| id | uuid | PK |
| discovery_run_id | uuid | FK → discovery_runs |
| doi | text | DOI string. EASA ADs use synthetic `easa-ad:{ad_number}`. Unique when non-null. |
| canonical_doi | text | Normalized lowercase DOI for dedup |
| title | text | Paper or AD title |
| title_fingerprint | text | Normalized title for fuzzy dedup |
| abstract | text | Abstract text. For EASA ADs: summary_text + required_actions + engine metadata. |
| abstract_hash | text | SHA-256 of normalized abstract for change detection |
| authors | jsonb | Array of author name strings |
| first_author | text | Normalized first author name |
| journal | text | Journal name or `'EASA Airworthiness Directive'` |
| publication_year | int | |
| source_url | text | DOI URL or EASA AD URL |
| source | text | `'corpus'`, `'easa_ad'`, `'discovery'` |
| external_ids | jsonb | e.g. `{"easa_ad": "2020-0261R1"}` |
| lifecycle_status | text | `'discovered'`, `'pending_classification'`, `'classified'`, `'stale'`, `'removed'` |
| classification_status | text | `'pending'`, `'classified'`, `'failed'` — coarse queue state for the classifier |
| first_seen_at | timestamptz | When first discovered |
| last_seen_at | timestamptz | Most recent discovery run that returned this paper |
| stale_at | timestamptz | Set when paper not seen in recent discovery sweeps |
| removed_at | timestamptz | Set when paper is presumed retracted/removed |
| discovery_score | numeric | Relevance score from discovery (0–1) |
| discovery_metadata | jsonb | Discovery run metadata |
| raw_payload | jsonb | Full original API response or import payload |

Query the database or `/admin` for current counts; never copy a snapshot into this file.

**Deduplication**: canonical DOI first, then title fingerprint + year, then abstract hash.

**EASA AD synthetic DOIs**: `easa-ad:2020-0261R1`, `easa-ad:2016-0242-CN`, etc. The `external_ids` jsonb field stores `{"easa_ad": "AD_NUMBER"}` for cross-reference back to `public.easa_ads`.

---

### `knowledge.classification_jobs`

One auditable row per (paper, classifier version). Prevents double-processing and tracks exactly what model produced each set of claims.

| Column | Type | Description |
|---|---|---|
| id | uuid | PK |
| paper_candidate_id | uuid | FK → paper_candidates |
| input_hash | text | SHA-256 of `{title, abstract}` — changes if content changes |
| classifier_version | text | Full version string e.g. `llm-extractor-v5:gemini:gemini-2.5-flash-lite` |
| mode | text | `'incremental'` or `'backfill'` |
| status | text | `'completed'`, `'failed'` |
| attempts | int | Retry count |
| started_at | timestamptz | |
| completed_at | timestamptz | |
| classifier_metadata | jsonb | `extractor`, `llm_provider`, `llm_model`, `claim_count`, `relationship_count` |

The code classifier prefix is `llm-extractor-v5`. Provider/model suffixes are runtime config.

**Version semantics**: changing the model or bumping `LLM_CLASSIFIER_VERSION` in `llm.py` makes all papers eligible for reclassification. Old jobs and their claims are kept until explicitly deleted.

Query completed jobs by version and provider for current runtime state.

---

### `knowledge.evidence_claims`

The core output table. One row per atomic extracted or inferred fact. This is what the app searches, filters, and assembles into FMEA rows.

| Column | Type | Description |
|---|---|---|
| id | uuid | PK |
| paper_candidate_id | uuid | FK → paper_candidates |
| classification_job_id | uuid | FK → classification_jobs |
| claim_type | text | One of 13 types (see below) |
| raw_value | text | Exact phrase extracted from source ("pins of the cylindrical rollers") |
| normalized_value | text | Canonical form ("roller pins") |
| support_type | text | `'direct_span'` or `'inferred_from_span'` |
| inference_rationale | text | Required for inferred claims — explains the reasoning |
| confidence | numeric | 0.0–1.0 |
| metadata | jsonb | `extractor`, other classifier metadata |
| review_status | text | `'needs_review'`, `'accepted'`, `'edited'`, `'rejected'`, `'superseded'` |
| created_at | timestamptz | |
| updated_at | timestamptz | |

Claim counts are runtime data and belong in `/admin`, not documentation.

**Claim type definitions** (constraint: `evidence_claims_claim_type_check`):

| claim_type | What it captures | Examples |
|---|---|---|
| `component` | Physical part or subsystem | bearing, turbine blade, gearbox, accessory gearbox |
| `failure_mode` | How something fails | fatigue fracture, corrosion, wear, delamination, thermal runaway |
| `cause` | Why the failure occurs | cyclic loading, poor lubrication, manufacturing defect, hydrogen embrittlement |
| `effect` | Consequence of failure | engine shutdown, oil loss, blade release, structural collapse, fire |
| `control` | Preventive measure or design control | inspection interval, protective coating, redesign, lubrication schedule |
| `corrective_action` | Reactive fix after confirmed failure/unsafe condition | part replacement, mandatory modification, AD compliance requirement |
| `analysis_method` | Investigation technique used | FEA, SEM, probabilistic fatigue assessment, ML, experimental testing, fracture mechanics |
| `application` | Operating industry or domain | aviation, wind energy, oil and gas, automotive, nuclear, marine |
| `operating_context` | Specific operating conditions | turbofan at cruise, offshore environment, high temperature cycling |
| `detection_method` | How failure was detected in service | visual inspection, vibration monitoring, borescope, ultrasonic testing |
| `maintenance_action` | Routine scheduled maintenance | lubrication interval, overhaul schedule |
| `material` | Material involved | CFRP, Inconel, titanium alloy, hardened steel |
| `environment` | Environmental condition | marine atmosphere, high humidity, elevated temperature |

**DO NOT** read `knowledge.evidence_records` — it is an empty legacy table from an earlier schema design that was never populated. The atomic claim approach in `evidence_claims` supersedes it entirely.

---

### `knowledge.evidence_spans`

One row per piece of source text that supports a claim. Provides full traceability from claim back to exact words in the original document.

| Column | Type | Description |
|---|---|---|
| id | uuid | PK |
| evidence_claim_id | uuid | FK → evidence_claims |
| source_field | text | `'title'`, `'abstract'`, or licensed `'full_text'` |
| text | text | Exact verbatim quote from the source field |
| char_start | int | Character offset where quote begins in source_field |
| char_end | int | Character offset where quote ends |
| license_safe | bool | Whether this span is safe to display (default true) |

Span counts are runtime data and belong in `/admin`, not documentation.

Every `direct_span` claim has at least one span with exact character positions. Inferred claims have spans pointing to the supporting evidence, not the inferred value.

---

### `knowledge.claim_relationships`

Typed directed links between two claims from the same paper. These form the FMEA graph structure — connecting components to failure modes, failure modes to causes, effects, controls, etc.

| Column | Type | Description |
|---|---|---|
| id | uuid | PK |
| paper_candidate_id | uuid | FK → paper_candidates |
| classification_job_id | uuid | FK → classification_jobs |
| subject_claim_id | uuid | FK → evidence_claims (the "from" node) |
| relationship_type | text | One of 8 types (see below) |
| object_claim_id | uuid | FK → evidence_claims (the "to" node) |
| support_type | text | `'direct_span'` or `'inferred_from_span'` |
| confidence | numeric | 0.0–1.0 |
| metadata | jsonb | Classifier metadata |
| review_status | text | `'needs_review'`, `'accepted'`, `'edited'`, `'rejected'`, `'superseded'` |

Relationship counts are runtime data and belong in `/admin`, not documentation.

**Relationship type definitions** (constraint: `claim_relationships_relationship_type_check`):

| relationship_type | Subject → Object | Meaning |
|---|---|---|
| `has_failure_mode` | component → failure_mode | This component exhibits this failure mode |
| `caused_by` | failure_mode → cause | This failure mode is caused by this cause |
| `has_effect` | failure_mode → effect | This failure mode produces this effect |
| `mitigated_by` | failure_mode → control | This failure mode is prevented/reduced by this control |
| `corrected_by` | failure_mode/component → corrective_action | This was corrected by this action |
| `detected_by` | failure_mode → detection_method | This failure mode is detected by this method |
| `analysed_by` | failure_mode/component → analysis_method | This was investigated using this method |
| `has_context` | failure_mode/component → operating_context/application/environment | This operates in this context |

---

### `public.easa_ads`

Original structured source table for EASA Airworthiness Directives. It is not written to by the classifier; these are upstream records.

Key columns: `ad_number`, `title`, `engine_family`, `engine_models` (jsonb array), `ata_chapter`, `issue_date`, `effective_date`, `summary_text` (extracted PDF reason section), `required_actions`, `compliance_time`, `ad_url`, `primary_pdf_url`, `approval_holder`, `source_category`, `keyword`.

EASA ADs are imported into `papers_raw.paper_candidates` via `paper-classifier import-easa`. The import builds the abstract from `summary_text` + `required_actions` + engine family/ATA metadata. The synthetic DOI is `easa-ad:{ad_number}`. The `external_ids` jsonb field links back: `{"easa_ad": "AD_NUMBER"}`.

---

## Data Flow: Discovery → Classifier → Knowledge

```
External APIs                   papers_raw                      knowledge
─────────────                   ──────────                      ─────────
OpenAlex API       ──►  paper_candidates  ──►  classification_jobs
                        (source=discovery)     evidence_claims
                                                evidence_spans
EASA Safety Tool   ──►  public.easa_ads         claim_relationships
  (import-easa)    ──►  paper_candidates
                        (source=easa_ad)

Zotero / corpus DB ──►  paper_candidates
                        (source=corpus/zotero)
```

**Step 1 — Discovery** (`services/paper-discovery`):
Queries OpenAlex by trusted journal ISSN × search query combinations. Upserts results into `papers_raw.paper_candidates` with `classification_status='pending'`. Creates one `discovery_runs` row per (journal, query) combination.

**Step 2 — Classification** (`services/paper-classifier`):
Polls `papers_raw.paper_candidates` for rows where `classification_status='pending'` or no completed `classification_jobs` row for the current classifier version. For each paper:
1. Sends title + abstract and, when legally ingested, bounded OA full text to the LLM.
2. LLM returns structured JSON: `relevance`, `confidence`, list of typed `claims`, list of typed `relationships`.
3. Each claim is validated, evidence-anchored, and written to `knowledge.evidence_claims`.
4. Each claim's supporting text is written to `knowledge.evidence_spans` with character offsets.
5. Relationships between claims are written to `knowledge.claim_relationships`.
6. `papers_raw.paper_candidates.classification_status` is set to `'classified'`.

**Step 3 — App queries** (`apps/web`):
The web app reads from `knowledge.*` for product workflows. `papers_raw.*` is used only for citation drill-downs. Engineers review, accept, edit, or reject claims via `review_status`.

---

## Key SQL Patterns for the App

### Find failure modes for a component with full FMEA chain

```sql
select
  comp.normalized_value       as component,
  fm.normalized_value         as failure_mode,
  cause.normalized_value      as cause,
  eff.normalized_value        as effect,
  ctrl.normalized_value       as control,
  ca.normalized_value         as corrective_action,
  meth.normalized_value       as analysis_method,
  pc.title,
  pc.doi,
  pc.journal,
  pc.publication_year,
  pc.source,
  cr_fm.confidence
from knowledge.claim_relationships cr_fm
join knowledge.evidence_claims comp on comp.id = cr_fm.subject_claim_id
join knowledge.evidence_claims fm   on fm.id   = cr_fm.object_claim_id
join papers_raw.paper_candidates pc  on pc.id  = cr_fm.paper_candidate_id
join knowledge.classification_jobs cj on cj.id = cr_fm.classification_job_id
  and cj.classifier_metadata->>'extractor' = 'llm'
left join knowledge.claim_relationships cr_cause on cr_cause.paper_candidate_id = pc.id
  and cr_cause.subject_claim_id = fm.id and cr_cause.relationship_type = 'caused_by'
left join knowledge.evidence_claims cause on cause.id = cr_cause.object_claim_id
left join knowledge.claim_relationships cr_eff on cr_eff.paper_candidate_id = pc.id
  and cr_eff.subject_claim_id = fm.id and cr_eff.relationship_type = 'has_effect'
left join knowledge.evidence_claims eff on eff.id = cr_eff.object_claim_id
left join knowledge.claim_relationships cr_ctrl on cr_ctrl.paper_candidate_id = pc.id
  and cr_ctrl.subject_claim_id = fm.id and cr_ctrl.relationship_type = 'mitigated_by'
left join knowledge.evidence_claims ctrl on ctrl.id = cr_ctrl.object_claim_id
left join knowledge.claim_relationships cr_ca on cr_ca.paper_candidate_id = pc.id
  and cr_ca.subject_claim_id = fm.id and cr_ca.relationship_type = 'corrected_by'
left join knowledge.evidence_claims ca on ca.id = cr_ca.object_claim_id
left join knowledge.claim_relationships cr_meth on cr_meth.paper_candidate_id = pc.id
  and cr_meth.subject_claim_id = fm.id and cr_meth.relationship_type = 'analysed_by'
left join knowledge.evidence_claims meth on meth.id = cr_meth.object_claim_id
where cr_fm.relationship_type = 'has_failure_mode'
  and comp.claim_type = 'component'
  and comp.normalized_value ilike '%bearing%'
order by cr_fm.confidence desc
limit 50;
```

### Get evidence spans for a paper (full traceability)

```sql
select
  ec.claim_type,
  ec.normalized_value,
  ec.confidence,
  ec.support_type,
  es.source_field,
  es.text           as evidence_text,
  es.char_start,
  es.char_end
from knowledge.evidence_claims ec
join knowledge.evidence_spans es on es.evidence_claim_id = ec.id
join knowledge.classification_jobs cj on cj.id = ec.classification_job_id
where ec.paper_candidate_id = $1
  and cj.classifier_metadata->>'extractor' = 'llm'
order by ec.claim_type, es.char_start;
```

### Search claims by type and value (for search UI)

```sql
select
  ec.id,
  ec.claim_type,
  ec.normalized_value,
  ec.raw_value,
  ec.confidence,
  ec.review_status,
  pc.title,
  pc.doi,
  pc.journal,
  pc.publication_year,
  pc.source
from knowledge.evidence_claims ec
join papers_raw.paper_candidates pc on pc.id = ec.paper_candidate_id
join knowledge.classification_jobs cj on cj.id = ec.classification_job_id
where ec.claim_type = 'failure_mode'
  and ec.normalized_value ilike '%fatigue%'
  and cj.classifier_metadata->>'extractor' = 'llm'
order by ec.confidence desc
limit 100;
```

### FMEA row assembly — count evidence per component

```sql
select
  comp.normalized_value                                   as component,
  count(distinct fm.id)                                   as failure_mode_count,
  count(distinct cause.id)                                as cause_count,
  count(distinct eff.id)                                  as effect_count,
  count(distinct ctrl.id)                                 as control_count,
  count(distinct ca.id)                                   as corrective_action_count,
  count(distinct pc.id)                                   as paper_count
from knowledge.evidence_claims comp
join knowledge.claim_relationships cr on cr.subject_claim_id = comp.id
  and cr.relationship_type = 'has_failure_mode'
join knowledge.evidence_claims fm on fm.id = cr.object_claim_id
join papers_raw.paper_candidates pc on pc.id = comp.paper_candidate_id
join knowledge.classification_jobs cj on cj.id = comp.classification_job_id
  and cj.classifier_metadata->>'extractor' = 'llm'
left join knowledge.claim_relationships cr2 on cr2.paper_candidate_id = pc.id
  and cr2.subject_claim_id = fm.id
left join knowledge.evidence_claims cause on cause.id = cr2.object_claim_id
  and cr2.relationship_type = 'caused_by'
left join knowledge.evidence_claims eff on eff.id = cr2.object_claim_id
  and cr2.relationship_type = 'has_effect'
left join knowledge.evidence_claims ctrl on ctrl.id = cr2.object_claim_id
  and cr2.relationship_type = 'mitigated_by'
left join knowledge.evidence_claims ca on ca.id = cr2.object_claim_id
  and cr2.relationship_type = 'corrected_by'
where comp.claim_type = 'component'
group by comp.normalized_value
order by failure_mode_count desc;
```

---

## Classifier Service: Complete Reference

Location: `services/paper-classifier/`

Install: `pip install -e .` from that directory.

### Subcommands

```sh
# Classify pending papers (normal operation)
paper-classifier classify \
  --mode incremental \
  --limit 200 \
  --extractor auto \
  --workers 8 \
  --watch \
  --interval-seconds 60

# Import EASA ADs from public.easa_ads into the pipeline
paper-classifier import-easa
paper-classifier import-easa --dry-run
paper-classifier import-easa --limit 50

# One-off backfill from SQLite corpus
paper-classifier import-corpus --corpus-db path/to/corpus.db
```

### Classifier flags

| Flag | Default | Description |
|---|---|---|
| `--extractor auto\|llm\|keyword` | `auto` | `auto` uses LLM if `LLM_PROVIDER` set, else keyword fallback |
| `--workers N` | `4` | Parallel API workers; production currently uses 1 to bound cost |
| `--limit N` | `25` | Max papers per batch |
| `--mode incremental\|backfill` | `incremental` | Written to `classification_jobs.mode` for auditing |
| `--watch` | off | Loop continuously |
| `--interval-seconds N` | `60` | Sleep between watch iterations |
| `--dry-run` | off | Classify and print without writing to DB |
| `--classifier-version TEXT` | auto | Override version string; normally auto-built from model name |

### Classifier version string

Format: `{LLM_CLASSIFIER_VERSION}:{provider}:{model}` for LLM, or `keyword-span-preprocessor-v1` for keyword extractor.

Current code prefix: `llm-extractor-v5` (runtime provider/model form the suffix).

Bumping `LLM_CLASSIFIER_VERSION` in `llm.py` (currently `"llm-extractor-v5"`) or changing the model makes all papers eligible for reclassification, because the `pending_candidates` query uses `not exists (completed job for this version)`.

### Pending candidate selection query

```sql
select * from papers_raw.paper_candidates pc
where pc.classification_status in ('pending', 'failed')
   or not exists (
     select 1 from knowledge.classification_jobs cj
     where cj.paper_candidate_id = pc.id
       and cj.classifier_version = :version
       and cj.status = 'completed'
   )
order by pc.publication_year desc nulls last, pc.created_at asc
limit :limit
```

### LLM prompt structure (v5)

The prompt extracts 13 claim types and 8 relationship types. Key rules enforced in prompt:
- `direct_span`: `evidence_text` must be an exact quote from title, abstract, or licensed full text.
- `inferred_from_span`: must cite supporting quote AND provide `inference_rationale`.
- Unsupported claims are not stored — LLM must have evidence.
- `not_relevant` papers return zero claims.

Gemini Flash thinking is disabled via `"thinkingConfig": {"thinkingBudget": 0}` in the request to avoid slow responses (~17s → ~5s per paper).

### Supported LLM providers

| Provider | Env vars | Notes |
|---|---|---|
| Gemini | `LLM_PROVIDER=gemini`, `GEMINI_API_KEY`, `GEMINI_MODEL=gemini-2.5-flash-lite` | Candidate model; thinking disabled. |
| Groq | `LLM_PROVIDER=groq`, `GROQ_API_KEY`, `GROQ_MODEL=llama-3.3-70b-versatile` | Free tier: 100k tokens/day (~150 papers). 3.5s delay between calls to avoid TPM limit. |
| OpenAI | `LLM_PROVIDER=openai`, `OPENAI_API_KEY`, `OPENAI_MODEL=gpt-5.4-nano` | Uses Responses API (`/v1/responses`). |
| Anthropic | `LLM_PROVIDER=anthropic`, `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL=claude-haiku-4-5` | Uses Messages API. |

### DB constraints that must be kept in sync

If adding new claim types or relationship types, update BOTH the Python enums AND the Postgres check constraints:

```sql
-- Check current claim_type constraint
select pg_get_constraintdef(oid) from pg_constraint
where conrelid = 'knowledge.evidence_claims'::regclass and conname like '%claim_type%';

-- Update example
alter table knowledge.evidence_claims drop constraint evidence_claims_claim_type_check;
alter table knowledge.evidence_claims add constraint evidence_claims_claim_type_check
  check (claim_type = any(array['component','failure_mode','cause','effect','control',
    'corrective_action','analysis_method','application','operating_context',
    'detection_method','maintenance_action','material','environment']::text[]));
```

---

## Discovery Service: Complete Reference

Location: `services/paper-discovery/`

Install: `pip install -e .` from that directory.

```sh
paper-discovery --watch --interval-seconds 3600
paper-discovery --dry-run --limit 10 --issn 1350-6307 --query "bearing failure"
```

### Data files (edit JSON, no Python changes needed)

- `data/journals.json` — 17 trusted journal ISSNs (Engineering Failure Analysis, Reliability Engineering & System Safety, IEEE Transactions on Reliability, NDT & E International, Wear, Tribology International, etc.)
- `data/queries.json` — 28 discovery queries split into `domain` (failure analysis, fatigue, FMEA, etc.) and `component` (bearing failure, pump failure, etc.) groups

### Source

- **OpenAlex** (sole source): ISSN + keyword filter, reconstructs abstract from inverted index, cursor pagination. Crossref support was removed 2026-07 — papers without abstracts are unclassifiable downstream, and OpenAlex ingests Crossref data with better abstract coverage.

Writes to `papers_raw.paper_candidates` with `source='discovery'` and deduplicates by canonical DOI (then title fingerprint + year as fallback).

### Discovery run strategy

For each (journal ISSN × query) = 17 journals × 28 queries = 476 API calls per full sweep. Each call fetches up to 100 results filtered to that journal. Papers without any DOI or title fingerprint are skipped.

With `--since-days N` the sweep becomes incremental: the OpenAlex filter gains `from_publication_date` and results sort newest-first, so weekly runs fetch recently published papers instead of re-fetching the same relevance-ranked top results. Recommended prod setting: `--since-days 30` (overlap covers indexing lag), with an occasional full sweep (no flag) to backfill.

---

## EASA Airworthiness Directives

EASA ADs are mandatory safety documents from the European Union Aviation Safety Agency. They describe confirmed unsafe conditions in aircraft and engines and mandate corrective actions. They are extremely high-quality sources for failure_mode, cause, effect, and corrective_action claims.

**Source**: `public.easa_ads` (query for current count)

**Import command**: `paper-classifier import-easa`

**Importer behaviour** (`services/paper-classifier/src/paper_classifier/easa_importer.py`):
- Reads from `public.easa_ads` where `summary_text` is non-null (skips cancelled/administrative ADs with no content)
- Builds abstract: `summary_text` (PDF reason section) + `required_actions` + engine family/ATA chapter metadata
- Synthetic DOI: `easa-ad:{ad_number}` (e.g. `easa-ad:2020-0261R1`)
- Journal: `'EASA Airworthiness Directive'`
- Source: `'easa_ad'`
- `external_ids`: `{"easa_ad": "AD_NUMBER"}`
- Upserts into `papers_raw.paper_candidates` — resets `classification_status='pending'` if abstract changed

**After import**: run `paper-classifier classify` normally — EASA ADs are treated identically to papers.

**Cross-reference**: to look up the full EASA AD from a classified claim:
```sql
select ea.*
from knowledge.evidence_claims ec
join papers_raw.paper_candidates pc on pc.id = ec.paper_candidate_id
join public.easa_ads ea on ea.ad_number = pc.external_ids->>'easa_ad'
where ec.id = $1;
```

---

## FMEA Row Assembly: How to Think About It

Do not treat one paper as one FMEA row.

A single paper or AD may contribute only part of a future FMEA row — for example, a cause and a failure mode but no effect. FMEA rows should be assembled from multiple atomic claims across multiple sources.

The recommended assembly pattern:
1. **Anchor on a component claim** (`claim_type = 'component'`).
2. **Follow `has_failure_mode` relationships** to find failure modes for that component.
3. **For each failure mode, follow** `caused_by`, `has_effect`, `mitigated_by`, `corrected_by`, `detected_by` relationships.
4. **Each FMEA field maps to one or more `evidence_claims`** — preserve this mapping in any FMEA suggestion table via `fmea_suggestion_evidence(fmea_suggestion_id, fmea_field, evidence_claim_id)`.
5. **Confidence** for the FMEA row = aggregate of contributing claim confidences.
6. **Review status** starts `needs_review` — human must accept before it becomes validated FMEA content.

---

## Access Patterns

- Web app server code: Supabase clients from `apps/web/src/lib/supabase/server.ts`
- Pipeline services: direct Postgres via `DATABASE_URL` or `SUPABASE_DB_URL` (psycopg3, `autocommit=True`)
- Browser code: must not receive service-role credentials or direct DB URLs
- Always schema-qualify: `papers_raw.paper_candidates`, not just `paper_candidates`
- Non-public schemas may need to be exposed in Supabase API settings for PostgREST access; direct Postgres access works immediately

---

## Pipeline Bot Deployment

The discovery/classifier services are currently deployed on a DigitalOcean droplet.

Server context:

- Host: `164.92.153.187`
- SSH key: `~/.ssh/riskonradar_do_ed25519`
- App snapshot: `/opt/riskonradar`
- Python virtualenv: `/opt/riskonradar/venv`
- Production env file: `/etc/riskonradar/pipeline.env`

Never commit the production env file or any values copied from it.

Systemd units:

- `riskonradar-discovery.timer`: enabled weekly discovery timer.
- `riskonradar-discovery.service`: one-shot discovery job.
- `riskonradar-classifier.service`: continuously running classifier worker.
- `riskonradar-full-text.timer`: weekly OA metadata/full-text timer.
- `riskonradar-full-text.service`: one-shot legal OA ingestion job.

Current production commands:

```sh
/opt/riskonradar/venv/bin/paper-discovery --limit 25 --since-days 30
/opt/riskonradar/venv/bin/paper-classifier classify --extractor llm --limit 25 --mode incremental --watch --interval-seconds 300 --workers 1
```

The versioned unit files are in `services/deploy/systemd/`. Runtime state must be checked with
`systemctl` and `journalctl`; do not infer deployment state from the repository.

Production behavior:

- Discovery runs weekly and writes new/changed papers to `pending_classification`.
- Classifier polls Supabase every 5 minutes and processes pending papers.
- The provider/model must be selected from the fixed human-scored evaluation and verified in job metadata.
- Keep production on `--extractor llm`; do not use `--extractor auto` unless the user explicitly accepts keyword fallback being saved.
- Worker count is intentionally `1` to protect quota/cost.

Useful operations:

```sh
ssh -i ~/.ssh/riskonradar_do_ed25519 root@164.92.153.187
systemctl status riskonradar-discovery.timer
systemctl status riskonradar-classifier.service
systemctl list-timers riskonradar-discovery.timer
journalctl -u riskonradar-discovery.service -f
journalctl -u riskonradar-classifier.service -f
systemctl restart riskonradar-classifier.service
```

Do not change this architecture without explicit user approval.
