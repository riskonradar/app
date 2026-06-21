# Risk on Radar

Evidence-backed FMEA intelligence platform for reliability and quality engineering teams.

Live site: https://riskonradar.com/ — App repo is this repository.

---

## What It Does

Risk on Radar turns fragmented failure literature into traceable FMEA workflows. The core loop:

1. **Search** by component, system, or operating context against a structured knowledge base built from peer-reviewed engineering literature and airworthiness directives.
2. **Review** ranked failure mode suggestions with causes, effects, controls, evidence spans, citations, and confidence scores.
3. **Accept / edit / reject** each suggestion. Human approval is required before anything becomes validated FMEA content.
4. **Assemble FMEA rows** from reviewed claims — each field is backed by one or more evidence claims with full source lineage.
5. **Save and export** analyses with RPN scoring (severity × occurrence × detection) and evidence lineage preserved.

The product is a copilot, not an autopilot. Engineers stay responsible for review.

---

## Current Knowledge Base (as of June 2026)

| Metric | Count |
|---|---|
| Paper candidates indexed | 3,417 |
| — Peer-reviewed corpus papers | 3,098 |
| — EASA airworthiness directives | 319 |
| Classified papers | 3,413 |
| Atomic evidence claims extracted | 14,990 |
| Evidence spans (exact source text with character offsets) | 20,365 |
| Claim relationships (FMEA-typed links between claims) | 3,729 |

Domains covered: aviation, wind energy, oil and gas, heavy industrial. Components covered include bearings, gears, pumps, seals, blades, shafts, valves, welds, pipelines, sensors, batteries, converters, and structural components.

Active classifier: `llm-extractor-v2:gemini:gemini-flash-latest`

---

## Architecture

```
apps/
  web/                  Next.js 16 app — product UI, API routes, server actions
services/
  paper-discovery/      Python 3.12 — queries Crossref and OpenAlex, writes raw candidates
  paper-classifier/     Python 3.12 — reads candidates, extracts FMEA evidence with LLM or keyword extractor
packages/
  shared/               Future shared types and schemas (currently empty)
```

### Web App (`apps/web`)

- **Framework**: Next.js 16, App Router, TypeScript
- **Auth**: Clerk (user + organization model; personal and team workspaces)
- **Database**: Supabase Postgres via service role client. Three schemas:
  - `app`: user accounts, organizations, memberships, billing
  - `papers_raw`: discovery runs and raw paper candidates
  - `knowledge`: classification jobs, evidence claims, spans, relationships
- **Billing**: Mollie (server-side only; keys never reach the browser)
- **Deployment**: Vercel via OpenNext/Cloudflare Workers

Key server modules:
- `apps/web/src/lib/account/server.ts` — workspace resolution, user/org upsert, billing status
- `apps/web/src/lib/fmea/server.ts` — FMEA analysis CRUD, row persistence, RPN computation, plan enforcement

Plan tiers: free (1 saved analysis), pro (unlimited). Billing status is checked server-side on every save.

### Paper Discovery Service (`services/paper-discovery`)

Python 3.12+ CLI. Searches Crossref and OpenAlex across trusted journal ISSNs and broad query packs. Upserts raw paper metadata into `papers_raw.paper_candidates`. Deduplicates by canonical DOI, title fingerprint + year, and abstract hash. Marks stale and removed papers without hard-deleting (evidence must stay auditable).

Paper lifecycle:
```
discovered -> pending_classification -> classified -> stale -> removed
```

Discovery writes `lifecycle_status = 'pending_classification'`. The classifier polls that column.

Production schedule: weekly via systemd timer on a DigitalOcean droplet.

### Paper Classifier Service (`services/paper-classifier`)

Python 3.12+ CLI. Polls `papers_raw.paper_candidates` for pending rows. Extracts atomic reliability claims from title and abstract. Writes to `knowledge.evidence_claims`, `knowledge.evidence_spans`, and `knowledge.claim_relationships`.

Claim types extracted: `component`, `failure_mode`, `cause`, `effect`, `control`, `corrective_action`, `analysis_method`, `application`, `operating_context`, `detection_method`, `maintenance_action`, `material`, `environment`.

Relationship types: `has_failure_mode`, `caused_by`, `has_effect`, `mitigated_by`, `detected_by`, `corrected_by`, `analysed_by`, `has_context`. Relationship direction is validated server-side before storage.

Two extraction modes:
- **`llm`**: structured JSON extraction via configured LLM provider. Direct claims are only accepted when `evidence_text` appears verbatim in the title or abstract. Inferred claims require `inference_rationale`. Unsupported output is dropped, not stored.
- **`keyword`**: deterministic keyword/span preprocessor. Conservative recall; exact span matching only.
- **`auto`**: uses `llm` when a provider is configured, otherwise falls back to `keyword`.

Supported LLM providers (set `LLM_PROVIDER`):

| Provider | Default model | Notes |
|---|---|---|
| `gemini` | `gemini-2.5-flash-lite` | Primary in production |
| `groq` | `llama-3.3-70b-versatile` | Rate-limited to ~17 papers/min on free tier |
| `openai` | `gpt-5.4-nano` | OpenAI Responses API |
| `anthropic` | `claude-haiku-4-5` | Anthropic Messages API |
| `ollama` | `llama3.1:8b` | Local inference via Ollama |

All LLM calls use temperature 0. Gemini calls disable thinking mode (`thinkingBudget: 0`). Failed LLM calls retry with exponential backoff (10s, 20s, 40s) before failing the job. Production uses `--workers 1` to protect quota.

Production command (runs continuously):
```sh
paper-classifier classify --extractor llm --limit 25 --mode incremental --watch --interval-seconds 300 --workers 1
```

---

## Database Schema Summary

```
papers_raw.paper_candidates      raw paper metadata, lifecycle state, dedupe fields
papers_raw.discovery_runs        one row per discovery run

knowledge.classification_jobs    one auditable attempt per paper × classifier version
knowledge.evidence_claims        one atomic extracted or inferred reliability claim
knowledge.evidence_spans         exact source text + character offsets for each claim
knowledge.claim_relationships    typed links between claims from the same paper

app.user_accounts                Clerk user mirror
app.organizations                personal and team workspaces
app.organization_memberships     user → workspace with role (owner, admin, member)
app.fmea_analyses                saved FMEA analysis records
app.fmea_rows                    individual FMEA rows with full field set and review state
app.billing_payments             Mollie payment records
app.workspace_invitations        pending invitations to team workspaces
```

Every extracted claim stores: classifier version, LLM provider + model, paper input hash, source paper ID, confidence, support type (`direct_span` or `inferred_from_span`), and review status. Sufficient metadata exists to audit how every suggestion was produced.

---

## Local Development

Prerequisites: Node.js, pnpm, Python 3.12+.

```sh
# Install web dependencies (from repo root)
pnpm install

# Start Next.js dev server
pnpm dev:web

# Build
pnpm build:web

# Lint
pnpm lint:web
```

```sh
# Paper discovery service
cd services/paper-discovery
pip install -e .
paper-discovery --source all --limit 10 --dry-run

# Paper classifier service
cd services/paper-classifier
pip install -e .
paper-classifier classify --extractor keyword --limit 5 --dry-run
```

Tests:
```sh
cd services/paper-discovery
PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=src python3 -m unittest discover -s tests

cd services/paper-classifier
PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=src python3 -m unittest discover -s tests
```

---

## Environment Variables

Copy `.env.example` to `.env.local` at repo root. Required variables:

```sh
# Database (Supabase session pooler, port 5432)
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# Auth
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=
CLERK_SECRET_KEY=
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up

# Billing
MOLLIE_API_KEY=

# Pipeline services (in .env or /etc/riskonradar/pipeline.env on droplet)
DATABASE_URL=                        # or SUPABASE_DB_URL
DISCOVERY_CONTACT_EMAIL=             # polite pool for Crossref/OpenAlex
LLM_PROVIDER=gemini                  # or groq, openai, anthropic, ollama
GEMINI_API_KEY=
GEMINI_MODEL=gemini-2.5-flash-lite
```

Never commit real keys. The production env file `/etc/riskonradar/pipeline.env` must not be committed.

---

## Production Deployment

**Web app**: Vercel (linked to this repo). Deployed via `pnpm build:web`.

**Pipeline services**: DigitalOcean droplet at `164.92.153.187`. Managed by systemd:

```
riskonradar-discovery.timer      weekly discovery
riskonradar-discovery.service    oneshot discovery run
riskonradar-classifier.service   long-running classifier worker (polls every 5 minutes)
```

SSH access:
```sh
ssh -i ~/.ssh/riskonradar_do_ed25519 root@164.92.153.187
journalctl -u riskonradar-classifier.service -f
systemctl status riskonradar-discovery.timer
```

The queue handoff between services is database state, not a direct service call. Discovery sets `lifecycle_status = 'pending_classification'`; the classifier polls that column.

---

## Design Principles

- Every suggestion is tied to a source span or explicitly marked as inference.
- Raw paper data and classified knowledge are stored in separate schemas.
- Review state is stored separately from model output.
- Papers are never hard-deleted; lifecycle state preserves evidence auditability.
- Human approval is required before classifier output becomes validated FMEA content.
- Classifier version, model, provider, and paper input hash are stored with every classification job for full audit trail.
