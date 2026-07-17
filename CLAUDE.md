# Risk on Radar App Context

This file gives Claude and other coding agents the project context needed to work in this repository.

Risk on Radar is a B2B application for adaptive reliability intelligence. It helps reliability and quality engineering teams turn fragmented failure evidence into traceable FMEA, root-cause analysis, predictive maintenance, and system-level risk assessment workflows.

## Repository Boundary

This repository is for the product application.

The public landing site is separate:

- Live site: https://riskonradar.com/
- Whitepaper: https://riskonradar.com/whitepaper.pdf
- Landing repo: https://github.com/riskonradar/landing

Do not turn this repository into the landing page. Marketing pages, waitlist content, SEO pages, and public launch copy belong in the landing repo. This repo should contain the authenticated app experience, product workflows, app services, domain models, tests, and product documentation.

## What the Product Does

Risk on Radar indexes peer-reviewed failure literature and engineering evidence into structured reliability knowledge, then surfaces that knowledge inside engineering workflows.

The core user workflow:

1. Search by component, system, asset, or operating context.
2. Review ranked failure modes with causes, effects, controls, citations, confidence, and evidence spans.
3. Accept, edit, reject, or annotate suggestions.
4. Build traceable FMEA rows.
5. Export or reuse validated reliability knowledge.

The product is a copilot, not an autopilot. Engineers remain responsible for review and approval.

## Product Pillars

### Living Failure Knowledge Engine

Continuously structures fragmented failure knowledge from scientific literature, industrial reports, reliability studies, sensor technologies, NDT investigations, standards, and validated internal sources.

### System-Level Risk Analysis

Models engineering assets as interconnected systems, not isolated parts. The implemented
foundation supports tenant-defined component trees, dependencies, reviewed failure
propagation, and conservative cascade paths. Aggregate reasoning is a separate optional,
review-only stage and must not mutate accepted system or FMEA truth.

### Cross-Domain Failure Intelligence

Transfers reliability knowledge across domains by comparing component context, operating conditions, failure mechanisms, and evidence signatures. Never copy risk scores blindly from one domain to another; adapt them to the target operating context and show uncertainty.

## Roadmap Context

Phase 1 — Failure Intelligence Engine (active):
- Living knowledge graph from peer-reviewed failure papers and EASA airworthiness directives.
- Structured ingestion through OpenAlex and regulatory sources.
- Component → failure mode → cause → effect → control taxonomy.
- DOI-linked citations, confidence scoring, evidence spans with character offsets.
- Human-in-the-loop validation.

Phase 2 — System-Level Risk Analysis (foundation implemented):
- Tenant-defined system/component trees backed by shared taxonomy nodes.
- Cross-component dependency visualization.
- Human-reviewed failure-propagation edges and conservative cascade paths.

Phase 3 — Cross-Domain Failure Intelligence:
- Multi-domain taxonomy alignment.
- Domain-adapted severity and occurrence tables.
- Standards mappings: ISO 26262, IEC 61508, DO-178C.

## Users

- reliability engineers
- quality engineers
- FMEA facilitators
- asset owners
- engineering managers
- maintenance and operations teams
- safety and compliance stakeholders

The app should feel like a professional engineering workspace: dense, clear, auditable, and built for repeated review work.

## Domain Language

Use these terms consistently:

- Asset: a physical engineering system or equipment item.
- System: a collection of dependent subsystems and components.
- Subsystem: a functional part of a larger system.
- Component: an engineering part with possible failure behavior.
- Failure mode: how something fails.
- Cause: why a failure occurs.
- Effect: local, subsystem, system, safety, operational, or financial consequence.
- Control: prevention, detection, inspection, design, maintenance, or mitigation action.
- Corrective action: reactive fix applied after a confirmed failure or unsafe condition.
- Analysis method: technique used to investigate a failure (FEA, SEM, probabilistic, ML, experimental).
- Application: operating industry or domain (aviation, wind energy, oil and gas).
- Evidence: source-backed support for a reliability claim.
- Citation: DOI, source URL, title, authors, publication metadata, and source trace.
- Confidence: the app's assessment of extraction quality, relevance, source strength, and validation state.
- Operating context: environmental and operational conditions affecting failure behavior.
- FMEA row: the structured, reviewed reliability record used in the user's FMEA workflow.

## Standards and Workflows

Known methods and standards in product scope:

- AIAG-VDA FMEA and Action Priority scoring.
- ISO 26262.
- IEC 61508.
- DO-178C as later standards mapping.
- 8D problem solving.
- Six Sigma.
- Reliability-centered maintenance.
- Root-cause analysis.
- Predictive maintenance and asset reliability management.

Do not claim a standard is supported unless the implementation actually supports it.

## AI and Evidence Rules

Evidence traceability is a core product requirement.

- Every suggestion must be tied to evidence or clearly marked as inference.
- Preserve provenance through ingestion, search, review, export, and audit logs.
- Store review state separately from model output.
- Show confidence and uncertainty.
- Do not present model-generated content as verified engineering truth.
- Human approval is required before suggestions become validated FMEA content.
- Keep enough metadata to audit how a suggestion was produced.

## UX Direction

Do not build marketing-style screens in this repo unless explicitly requested.

Prefer:
- searchable evidence tables
- FMEA builder tables
- split-pane review flows
- citations and evidence drawers
- confidence indicators
- filters by component, failure mode, source, domain, standard, confidence, and review state
- graph views for assets, dependencies, and propagation paths
- export controls
- review queues and audit history

Avoid:
- oversized hero sections
- public waitlist flows
- untraceable AI chat as the primary workflow
- automatic engineering decisions
- vague risk claims without source evidence

## Current Technical Status

Approved starting architecture:

- `apps/web`: Next.js 16 app (pnpm workspace). Product UI, authenticated workspace, lightweight API routes and server actions, normal DB reads/writes.
- `services/paper-discovery`: Python 3.12+ service. Queries the OpenAlex API across trusted journal ISSNs, upserts raw paper candidates into `papers_raw.paper_candidates`. (Crossref support removed 2026-07: abstract-less papers are unclassifiable, and OpenAlex ingests Crossref data with better abstract coverage.)
- `services/paper-classifier`: Python 3.12+ service. Reads pending paper candidates, extracts atomic evidence claims with a keyword/span extractor or LLM, writes to `knowledge.*`.
- `packages/shared`: optional shared types/schemas once contracts stabilize. Currently empty.

Package manager: pnpm (workspace root at repo root, `pnpm-workspace.yaml` lists `apps/*`, `services/*`, `packages/*`).

### Frontend commands (from repo root)

```sh
pnpm dev:web       # start Next.js dev server
pnpm build:web     # production build
pnpm lint:web      # ESLint
```

### Paper discovery commands

```sh
cd services/paper-discovery
pip install -e .
paper-discovery --watch --interval-seconds 3600
paper-discovery --dry-run --limit 10 --issn 1350-6307 --query "bearing failure"
```

Flags: `--limit N`, `--since-days N` (incremental: only papers published in the last N days, newest first), `--dry-run`, `--watch`, `--interval-seconds N`, `--issn ISSN` (repeatable), `--query QUERY` (repeatable).

### Paper classifier commands

```sh
cd services/paper-classifier
pip install -e .
paper-classifier classify --mode incremental --limit 25 --extractor llm --workers 1 --watch --interval-seconds 300
paper-classifier import-easa                  # import from public.easa_ads
paper-classifier import-easa --dry-run        # preview without writing
paper-classifier import-corpus --corpus-db path/to/corpus.db
paper-classifier ingest-full-text --limit 100
paper-classifier link-taxonomy
paper-classifier reason-system --organization-id UUID --asset-id UUID       # preview
paper-classifier reason-system --organization-id UUID --asset-id UUID --execute
```

Key flags for classify: `--extractor auto|llm|keyword`, `--workers N`, `--limit N`, `--watch`, `--dry-run`.
Production must use `--extractor llm`. `auto`/`keyword` are diagnostics only and their jobs
must never be represented as LLM output.

### Environment variables

```sh
# Both pipeline services
DATABASE_URL=postgresql://postgres.PROJECT:PASSWORD@aws-0-eu-west-1.pooler.supabase.com:5432/postgres
# or SUPABASE_DB_URL as alias

# Paper discovery
DISCOVERY_CONTACT_EMAIL=you@example.com   # polite pool priority for OpenAlex

# Paper classifier — example provider, not a claim about production
LLM_PROVIDER=gemini
GEMINI_API_KEY=...
GEMINI_MODEL=gemini-2.5-flash-lite         # example candidate; not a production-state claim

# Other supported providers
# LLM_PROVIDER=groq
# GROQ_API_KEY=...
# GROQ_MODEL=llama-3.3-70b-versatile      # free tier: 100k tokens/day
# LLM_PROVIDER=openai
# OPENAI_API_KEY=...
# OPENAI_MODEL=gpt-5.4-nano
# LLM_PROVIDER=anthropic
# ANTHROPIC_API_KEY=...
# ANTHROPIC_MODEL=claude-haiku-4-5

# Optional aggregate reasoner: separate provider/model/key from per-paper extraction
REASONING_LLM_PROVIDER=...
REASONING_LLM_MODEL=...
REASONING_LLM_API_KEY=...

# Web app
NEXT_PUBLIC_SUPABASE_URL=https://rqzwdzhphxuayqwptqia.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=...
CLERK_SECRET_KEY=...
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up
STRIPE_SECRET_KEY=...
STRIPE_WEBHOOK_SECRET=...
STRIPE_INDIVIDUAL_PRICE_ID=...
```

All secrets go in `.env.local` at the repo root. Never commit real keys. `.env.example` has the template.

## Pipeline Bot Deployment

Detailed service handoff and operations docs live in `services/AGENTS.md` and `services/CLAUDE.md`. Read those before changing discovery, classification, evidence extraction, pipeline migrations, or the droplet deployment.

Current DigitalOcean deployment:

```text
Host: 164.92.153.187
SSH key: ~/.ssh/riskonradar_do_ed25519
App snapshot: /opt/riskonradar
Python venv: /opt/riskonradar/venv
Production env: /etc/riskonradar/pipeline.env
```

Systemd units:

```sh
riskonradar-discovery.timer
riskonradar-discovery.service
riskonradar-classifier.service
riskonradar-full-text.timer
riskonradar-full-text.service
```

Runtime model:

- Discovery runs weekly and writes new/changed candidates as `pending_classification`.
- Classifier runs continuously, polling pending candidates every 5 minutes.
- The queue handoff is Supabase state, not a direct service-to-service call.
- The configured provider must be chosen from the fixed human-scored evaluation, not from docs.
- Query `knowledge.classification_jobs` to verify the provider/model actually producing jobs.
- Do not use `--extractor auto` in production unless the user explicitly accepts keyword fallback being saved.
- Never commit `/etc/riskonradar/pipeline.env` or values copied from it.

Useful checks:

```sh
ssh -i ~/.ssh/riskonradar_do_ed25519 root@164.92.153.187
systemctl status riskonradar-discovery.timer
systemctl status riskonradar-classifier.service
journalctl -u riskonradar-classifier.service -f
```

## Architecture Decisions

Backend: Use Next.js for the app backend. Do not add a separate general-purpose backend service yet. Keep paper discovery and classification outside Next.js — they are background pipeline concerns.

Database: Supabase Postgres. Use the session pooler (port 5432, `aws-0-eu-west-1.pooler.supabase.com`) not the direct connection (IPv6 only on free tier).

Auth: Clerk personal accounts and organizations. Mirror minimum user/workspace state in
`app.*`; enforce owner/admin/member/viewer permissions on every product mutation.

Billing: Stripe Billing with hosted Checkout Sessions. Server-side only. Secrets never reach browser code.

Do not change this architecture without explicit user approval.

## Live Database State (Supabase)

Supabase project: `https://rqzwdzhphxuayqwptqia.supabase.co`

Never copy live counts or an "active model" into this document. Use the gated `/admin`
dashboard or schema-qualified queries against `papers_raw.paper_candidates`,
`knowledge.classification_jobs`, `knowledge.evidence_claims`, `knowledge.evidence_spans`, and
`knowledge.claim_relationships`. The code classifier prefix is currently
`llm-extractor-v5`; production history may contain other versions and providers.

The knowledge base covers failure modes, causes, effects, controls, corrective actions, analysis methods, and applications across bearings, gears, pumps, seals, blades, shafts, valves, welds, pipelines, sensors, batteries, converters, and structural components — predominantly in aviation, wind energy, oil and gas, and heavy industrial domains.

## First Build Target

The first app milestone is an evidence-backed FMEA workflow:

1. Search interface for component/system/context queries against the knowledge base.
2. Display ranked failure suggestions with evidence spans, citations, and confidence.
3. Accept, edit, reject, and annotate states backed by `review_status` on claims.
4. Assemble traceable FMEA rows from reviewed claims (one FMEA field → one or more evidence claims).
5. Export FMEA rows with full evidence lineage.

Keep all implementation decisions aligned with auditability, engineering traceability, and human-in-the-loop review.

Do not add new architecture, repository structure, or stack decisions to this file unless the user explicitly approves them first.
