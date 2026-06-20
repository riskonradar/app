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

Risk on Radar is an evidence-backed FMEA intelligence platform for reliability and quality engineering teams. Its differentiator is not another blank-row FMEA editor; it is the external intelligence layer: a continuously updated failure knowledge graph built from peer-reviewed failure literature and structured engineering evidence.

The app should behave as an engineering copilot, not an autopilot. It surfaces documented failure modes, causes, effects, controls, confidence signals, and citations so engineers can accept, edit, reject, and defend decisions. Human review and source traceability are core product requirements.

## Core Product Pillars

1. Living Failure Knowledge Engine
   - Continuously structures fragmented engineering failure knowledge.
   - Uses semantic reasoning, reliability taxonomies, LLM-assisted extraction, and human validation.
   - Normalizes evidence into component, failure mode, cause, effect, control, operating context, citation, confidence, and evidence-span records.
   - Supports FMEA, 8D, Six Sigma, RCM, RCA, predictive maintenance, and reliability knowledge management workflows.

2. System-Level Risk Analysis
   - Models assets as interconnected systems instead of isolated components.
   - Represents subsystem dependencies, interface failures, propagation paths, cascading failures, bottlenecks, and system-wide vulnerabilities.
   - Should eventually support existing and user-defined engineering systems.

3. Cross-Domain Failure Intelligence
   - Finds transferable failure signatures across industries and operating contexts.
   - Compares component context, operating conditions, failure mechanisms, and evidence signatures.
   - Adapts source-domain reliability knowledge to target operating environments rather than copying risk scores directly.

## Initial App Scope

Prioritize the Phase 1 product: the Failure Intelligence Engine and evidence-backed FMEA workflow.

The first valuable product loop is:

1. Engineer searches by component, system, or operating context.
2. App returns ranked failure modes with causes, effects, controls, confidence, and citations.
3. Engineer reviews source-linked evidence.
4. Engineer accepts, edits, or rejects suggestions.
5. App builds traceable FMEA rows that can be exported or reused.

Do not build marketing pages here unless explicitly requested. Link back to the public landing site for waitlist, public explanation, and SEO pages.

## Domain Concepts

Use consistent domain language:

- Asset: a physical engineering system or equipment item.
- System: a collection of subsystems/components with dependencies.
- Subsystem: a functional part of a larger asset.
- Component: an engineering part such as bearing, gearbox, blade, converter, sensor, seal, valve, pump, structural member, or power electronics module.
- Failure mode: how a component or system fails.
- Cause: why the failure mode occurs.
- Effect: local, subsystem, system, operational, safety, or financial consequence.
- Control: prevention, detection, inspection, maintenance, design, or mitigation action.
- Evidence source: paper, standard, industrial report, sensor record, NDT record, or validated internal knowledge.
- Citation: DOI, publisher metadata, source URL, title, authors, publication year, and traceable evidence spans.
- Confidence: score or label explaining extraction quality, source strength, relevance, and validation status.
- Operating context: environment, loading, duty cycle, temperature, speed, materials, maintenance regime, domain, and constraints.
- FMEA row: structured record containing function, requirement, failure mode, effect, severity, cause, occurrence, controls, detection, action priority, recommended action, owner/status, evidence, and review state.

## Standards and Methods

The product should be designed around established reliability workflows while avoiding fake certainty.

Known standards and methods in scope:

- AIAG-VDA FMEA, including Action Priority scoring.
- ISO 26262 for functional safety contexts.
- IEC 61508 for functional safety contexts.
- DO-178C as a later aerospace/software safety mapping target.
- 8D problem solving.
- Six Sigma.
- Reliability-centered maintenance.
- Root-cause analysis.

When standards support is incomplete, label it clearly in the UI and documentation.

## Evidence and Data Requirements

Evidence-backed behavior is non-negotiable:

- Every generated suggestion must preserve provenance.
- Prefer DOI-linked citations when available.
- Preserve evidence text spans or structured excerpts where licensing allows.
- Separate extracted facts from model inference.
- Store confidence and validation status separately.
- Keep human-in-the-loop review state explicit.
- Never present LLM output as a verified engineering fact without evidence or review status.

Expected ingestion sources include Crossref, Elsevier TDM APIs, Springer Nature APIs, open-access literature, licensed journal literature, industrial reports, standards, NDT records, sensor data, and validated internal reliability documents.

## UX Principles

The app is for reliability engineers, quality engineers, asset owners, and engineering managers. It should feel like a professional engineering workspace:

- Dense, readable, and work-focused.
- Built for scanning, comparison, review, traceability, and repeated use.
- Prefer tables, filters, split panes, evidence drawers, graph views, and review queues over marketing-style cards.
- Make citations, confidence, and review state visible near suggestions.
- Support accept, edit, reject, annotate, and export actions.
- Keep AI behavior explainable and interruptible.
- Avoid making engineering decisions automatically.

## Engineering Rules for Agents

- Read this file and `CLAUDE.md` before making substantial changes.
- Treat the public website and whitepaper as product context, not as implementation code.
- Keep this repo focused on the app. Do not duplicate landing-page content unless the app needs an authenticated in-product version.
- Do not invent regulatory or standards compliance that has not been implemented.
- Do not hard-code demo claims such as paper counts unless they come from configured data or approved copy.
- Prefer typed domain models for FMEA rows, evidence records, citations, confidence, review states, assets, systems, and components.
- Keep generated AI content auditable: inputs, model/version when applicable, evidence references, timestamp, and reviewer actions.
- Add tests around domain transformations, scoring, ingestion normalization, permissions, exports, and evidence traceability.
- Before adding a dependency, confirm it fits the chosen stack and product direction.
- If you introduce a framework, add setup, run, test, and build commands to this file and the README.
- Do not add new architecture, repository structure, or stack decisions to this file unless the user explicitly approves them first.

## Current Status

This is a new app repository. The approved starting architecture is a small monorepo with a Next.js app and two separate pipeline services.

Approved repository direction:

- `apps/web`: Next.js application for the product UI, authenticated workspace, lightweight app API routes/server actions, and normal database reads/writes.
- `services/paper-discovery`: lightweight service that continuously searches journal/publisher sources by keywords and stores raw candidate papers in the database.
- `services/paper-classifier`: heavier classification service that reads candidate paper titles/abstracts, uses a small LLM/classifier pipeline, and writes classified reliability knowledge into a separate classified knowledge store or schema.
- `packages/shared`: optional shared types/schemas once contracts stabilize.

Backend direction:

- Do not add a separate general-purpose backend service yet.
- Use Next.js for the app backend unless the app API becomes too large or needs independent scaling.
- Keep paper discovery and paper classification outside Next.js because they are background pipeline concerns.

Database direction:

- Use Supabase Postgres for the MVP rather than SQLite.
- SQLite is acceptable only for throwaway local tests and one-off corpus backfills, not the main app data model.
- Keep raw paper candidate data separate from classified/validated reliability knowledge.
- Current Supabase project URL: `https://rqzwdzhphxuayqwptqia.supabase.co`.
- The initial database migrations separate data into `app`, `papers_raw`, and `knowledge` schemas.
- `app` stores the local user/account mirror and billing records. Clerk remains the auth source of truth.
- `papers_raw` stores discovery runs and raw paper candidates.
- `knowledge` stores machine classifications, atomic evidence claims, evidence spans, claim relationships, and later reviewed reliability knowledge.

## Supabase Database Context

Agents working with persistence should assume Supabase Postgres is the product database. Do not create another general-purpose database or backend without explicit user approval.

Access patterns:

- Web app server code should use Supabase clients from `apps/web/src/lib/supabase/server.ts`.
- Pipeline services should connect to Postgres with `DATABASE_URL` or `SUPABASE_DB_URL`.
- Browser code must not receive service-role credentials or direct pipeline database URLs.
- Local secrets belong in `.env.local` or service-local environment variables and must not be committed.

Primary schemas:

- `app`: product app metadata such as `user_accounts`, `billing_customers`, and `billing_payments`.
- `papers_raw`: raw discovery/corpus input. This is the source-of-record for candidate papers before classification.
- `knowledge`: machine-generated and reviewed reliability intelligence derived from raw papers.

Raw paper tables:

- `papers_raw.discovery_runs`: records each discovery or corpus backfill run, including source, query, status, timestamps, and metadata.
- `papers_raw.paper_candidates`: raw paper metadata with DOI, title, abstract, authors, journal, publisher, publication year, source URL, source, raw payload, and `classification_status`.
- `papers_raw.paper_candidates.classification_status` should be treated as a coarse queue state such as `pending`, `classified`, or `failed`.
- Raw candidates are deduplicated by DOI in the current migration. If a source has no DOI, add an explicit dedupe strategy before broad ingestion.

Knowledge tables:

- `knowledge.paper_classifications`: legacy/coarse per-paper classification summary.
- `knowledge.classification_jobs`: one auditable classifier run per paper input hash and classifier version/model.
- `knowledge.evidence_claims`: atomic extracted or inferred claims. One row should represent one component, failure mode, cause, effect, control, operating context, detection method, maintenance action, material, or environment claim.
- `knowledge.evidence_spans`: exact source text supporting a claim, including source field and optional character offsets.
- `knowledge.claim_relationships`: machine-proposed links between claims from the same paper, such as component `has_failure_mode` failure mode, failure mode `caused_by` cause, failure mode `has_effect` effect, failure mode `mitigated_by` control, failure mode `detected_by` detection method, or failure mode `has_context` context.

Evidence and inference rules:

- `support_type='direct_span'` means the claim value is directly present in source text.
- `support_type='inferred_from_span'` means the claim is a model or rule inference from one or more source spans.
- Inferred claims must include source evidence spans and an `inference_rationale`.
- Unsupported LLM output should be dropped rather than stored.
- Do not present `knowledge` records as validated engineering truth until `review_status` indicates human acceptance.

Classifier service behavior:

- The classifier lives in `services/paper-classifier`.
- It assumes papers are already in `papers_raw.paper_candidates` for normal operation.
- The SQLite `corpus.db` importer is only a backfill helper for the existing `riskonradar/corpus` data.
- The normal production command shape is:

```sh
paper-classifier classify --mode incremental --limit 50 --extractor auto --watch --interval-seconds 60
```

- `--extractor auto` uses the configured LLM provider when available, otherwise the deterministic keyword/span extractor.
- Supported LLM provider env vars:

```sh
LLM_PROVIDER=gemini
GEMINI_API_KEY=...
GEMINI_MODEL=gemini-2.5-flash-lite

LLM_PROVIDER=openai
OPENAI_API_KEY=...
OPENAI_MODEL=gpt-5.4-nano

LLM_PROVIDER=anthropic
ANTHROPIC_API_KEY=...
ANTHROPIC_MODEL=claude-haiku-4-5
```

- The classifier selects papers that are pending/failed or do not have a completed `knowledge.classification_jobs` row for the current classifier version/model.
- Changing classifier version or model intentionally makes existing papers eligible for reprocessing.
- If a paper candidate is deleted, related classifications, classifier jobs, evidence claims, evidence spans, and claim relationships should be removed by foreign-key cascades.
- The frontend should generally query `knowledge` records for product workflows and use `papers_raw` only for source/citation drill-downs.

Do not change this architecture without explicit user approval.
