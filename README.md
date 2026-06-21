# Risk on Radar

Evidence-backed FMEA workspace for reliability and quality engineering teams. The app turns peer-reviewed failure literature and airworthiness directives into reviewable FMEA rows — every field backed by an exact source span and a DOI-linked citation.

**Current scope:** only the turbofan engine dataset is live. The knowledge base covers bearings, blades, combustors, compressors, fuel systems, oil systems, seals, shafts, turbines, and structural components in commercial aviation context. Other domains and systems are in roadmap scope but not yet searchable.

Live: https://riskonradar.com/ — whitepaper: https://riskonradar.com/whitepaper.pdf

---

## Live Knowledge Base (June 2026)

| Metric | Count |
|---|---|
| Paper candidates indexed | 3,417 |
| — Peer-reviewed corpus papers | 3,098 |
| — EASA airworthiness directives | 319 |
| Classified papers | 3,413 |
| Pending (no abstract) | 4 |
| Atomic evidence claims | 14,990 |
| Evidence spans (exact source text + character offsets) | 20,365 |
| Claim relationships (FMEA-typed links between claims) | 3,729 |

Active classifier: `llm-extractor-v2:gemini:gemini-2.5-flash-lite`

---

## Classification Pipeline

### 1. Paper Discovery (`services/paper-discovery`)

Python 3.12+ CLI. Runs weekly on DigitalOcean via systemd timer.

- Searches Crossref and OpenAlex REST APIs.
- Restricted to trusted journal ISSNs listed in `data/journals.json`.
- Broad search query packs from `data/queries.json` — these are recall filters only; the classifier decides relevance.
- Deduplicates by: `canonical_doi` → `title_fingerprint + publication_year` → `abstract_hash`.
- Upserts raw metadata into `papers_raw.paper_candidates` with `lifecycle_status = 'pending_classification'`.
- Papers are never hard-deleted. Lifecycle state transitions: `discovered → pending_classification → classified → stale → removed`.
- Tracks each run in `papers_raw.discovery_runs`.

### 2. Evidence Extraction (`services/paper-classifier`)

Python 3.12+ CLI. Runs continuously on DigitalOcean, polling every 5 minutes.

**Input:** paper title and abstract from `papers_raw.paper_candidates`.

**Extraction modes:**

- `--extractor llm`: structured JSON extraction via LLM. Direct claims (`support_type = direct_span`) are accepted only when `evidence_text` appears verbatim in the title or abstract — the classifier verifies exact substring match and records `char_start`/`char_end` offsets. Inferred claims (`inferred_from_span`) must include `inference_rationale`. Output that fails schema validation or span verification is dropped, not stored.
- `--extractor keyword`: deterministic keyword/span preprocessor (`keyword-span-preprocessor-v1`). Matches alias lists against source text, generates `direct_span` claims, and infers a small set of compound claims (e.g. corrosion + fatigue → corrosion fatigue) and sentence-level effect/control claims via pattern matching. Conservative recall; no LLM calls.
- `--extractor auto`: uses `llm` when `LLM_PROVIDER` is set, otherwise falls back to `keyword`.

**LLM providers:**

| `LLM_PROVIDER` | Default model | API |
|---|---|---|
| `gemini` | `gemini-2.5-flash-lite` | Gemini generateContent, `thinkingBudget: 0` |
| `groq` | `llama-3.3-70b-versatile` | OpenAI-compatible chat completions |
| `openai` | `gpt-5.4-nano` | OpenAI Responses API (`/v1/responses`) |
| `anthropic` | `claude-haiku-4-5` | Anthropic Messages API |
| `ollama` | `llama3.1:8b` | Local Ollama chat API |

All LLM calls use `temperature = 0`. Groq rate-limits to ~17 papers/min on the free tier (3.5s forced delay between calls). Failed calls retry with exponential backoff: 10s, 20s, 40s.

**What gets extracted per paper:**

Claim types: `component`, `failure_mode`, `cause`, `effect`, `control`, `corrective_action`, `analysis_method`, `application`, `operating_context`, `detection_method`, `maintenance_action`, `material`, `environment`.

Relationship types: `has_failure_mode`, `caused_by`, `has_effect`, `mitigated_by`, `detected_by`, `corrected_by`, `analysed_by`, `has_context`. Relationship direction is validated server-side before storage; invalid directions are dropped.

Failure mode normalized values are mapped to a canonical label set (Crack / fracture, Fatigue, FOD, Wear / rubbing, Corrosion / pitting, Bearing fault, Creep, Erosion, etc.) — uncategorizable failure modes are dropped rather than stored as noise.

**Output written to Supabase:**

- `knowledge.classification_jobs` — one auditable attempt per paper × classifier version, with LLM provider, model, paper input hash, relevance, and confidence.
- `knowledge.evidence_claims` — one row per atomic claim with `claim_type`, `raw_value`, `normalized_value`, `support_type`, `confidence`, `classifier_version`, `llm_provider`, `llm_model`.
- `knowledge.evidence_spans` — one row per span with exact `text`, `char_start`, `char_end`, `source_field` (title or abstract).
- `knowledge.claim_relationships` — typed links with `subject_index`, `relationship_type`, `object_index`, `support_type`, `confidence`.

Paper is marked `lifecycle_status = 'classified'` on success.

**Production command:**
```sh
paper-classifier classify --extractor llm --limit 25 --mode incremental --watch --interval-seconds 300 --workers 1
```

---

## FMEA Workflow

1. **Search** — query the knowledge base by component, system, or operating context. Results come from a Supabase RPC (`get_turbofan_fmea`) that aggregates evidence claims by component and failure mode.

2. **Review** — ranked failure mode rows show cause, effect, controls, corrective actions, evidence count, and source citations (DOI / EASA AD reference). RPN (severity × occurrence × detection) is pre-computed; severity is inferred from effect text and propagation path matching, occurrence from weighted evidence count, detection from inspection/monitoring keyword presence and EASA AD instruction detection.

3. **Accept / edit / reject** — `review_status` on `fmea_rows` tracks per-row state (`needs_review`, `accepted`, `rejected`). Model output and review state are stored separately. Human approval is required before classifier output becomes validated FMEA content.

4. **Save** — analyses persist to `app.fmea_analyses` and `app.fmea_rows` under the current workspace (personal or organization). Free tier: 1 saved analysis. Pro tier: unlimited. Plan enforcement runs server-side on every save — the limit check and the insert are sequential to avoid race conditions.

5. **Export** — CSV and XLSX export with full evidence lineage preserved per row.

---

## Pricing

Plans are defined in `apps/web/src/lib/billing/plans.ts`. Payment processing via Mollie (server-side only; keys never reach browser code). Currency: EUR.

| Plan | Price | Scope | Seats | Key limits |
|---|---|---|---|---|
| Free | EUR 0 | user | 1 | 1 saved FMEA table |
| Individual (Pro) | EUR 49 / month | user | 1 | Unlimited saved analyses, evidence-linked exports |
| Team | EUR 399 / month | organization | 3 included | Shared FMEA projects, member roles, audit trail |
| Enterprise | Custom | organization | Custom | SAML/OIDC SSO readiness, domain rollout, custom billing |

`billing_status` on `app.organizations` drives plan enforcement: `active` and `comped` are treated as Pro; anything else falls back to free limits.

Mollie webhook (`/api/billing/mollie-webhook`) updates `app.billing_payments` and `app.organizations` on payment status changes, and writes an audit event to `app.account_audit_events`.

---

## Auth and Workspace

Auth: Clerk. JWT verified server-side on every request via `CLERK_SECRET_KEY`. Supports both Bearer token and `__session` cookie.

Workspace resolution (`ensureCurrentWorkspace`):
- If Clerk org context present → upsert `app.organizations` by `clerk_organization_id` (team workspace).
- Otherwise → upsert personal workspace by deterministic slug derived from `clerk_user_id`.

Roles: `owner`, `admin`, `member` (normalized from Clerk's `org:owner` / `org:admin` claim names).

Minimum Clerk user metadata mirrored to `app.user_accounts`.

---

## Stack

**Web app (`apps/web`):**
- Next.js 16, App Router, TypeScript
- Supabase Postgres via service role client (three schemas: `app`, `papers_raw`, `knowledge`)
- Clerk for auth
- Mollie for payments
- Deployed on Cloudflare Workers via OpenNext (`wrangler.toml`, `compatibility_flags = ["nodejs_compat"]`)

**Pipeline services:**
- Python 3.12+, stdlib only for HTTP (`urllib.request`) — no heavy framework dependencies
- Same Supabase Postgres database; connects via session pooler (`aws-0-eu-west-1.pooler.supabase.com:5432`)
- Deployed on DigitalOcean droplet (`164.92.153.187`) managed by systemd

**Key database tables:**

```
papers_raw.paper_candidates        raw metadata, lifecycle state, dedupe fields
papers_raw.discovery_runs          one row per discovery run

knowledge.classification_jobs      auditable classifier attempt per paper × version
knowledge.evidence_claims          atomic extracted or inferred reliability claim
knowledge.evidence_spans           exact source text + character offsets
knowledge.claim_relationships      typed links between claims from the same paper

app.user_accounts                  Clerk user mirror
app.organizations                  personal and team workspaces
app.organization_memberships       user → workspace with role
app.fmea_analyses                  saved FMEA analysis records
app.fmea_rows                      individual FMEA rows with review state
app.billing_payments               Mollie payment records
app.account_audit_events           billing and workspace audit log
app.workspace_invitations          pending team invitations
```

---

## Local Development

Prerequisites: Node.js, pnpm, Python 3.12+.

```sh
pnpm install
pnpm dev:web
pnpm build:web
pnpm lint:web
```

```sh
cd services/paper-discovery
pip install -e .
paper-discovery --source all --limit 10 --dry-run

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

Copy `.env.example` to `.env.local` at repo root.

```sh
# Web app
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=
CLERK_SECRET_KEY=
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up
MOLLIE_API_KEY=                         # or MOLLIE_TEST_API_KEY for sandbox

# Pipeline services (both)
DATABASE_URL=                           # or SUPABASE_DB_URL; session pooler port 5432
DISCOVERY_CONTACT_EMAIL=               # polite pool priority for Crossref/OpenAlex

# Paper classifier — choose one provider
LLM_PROVIDER=gemini
GEMINI_API_KEY=
GEMINI_MODEL=gemini-2.5-flash-lite     # default; thinkingBudget=0 set in code

# LLM_PROVIDER=groq
# GROQ_API_KEY=
# GROQ_MODEL=llama-3.3-70b-versatile

# LLM_PROVIDER=openai
# OPENAI_API_KEY=
# OPENAI_MODEL=gpt-5.4-nano

# LLM_PROVIDER=anthropic
# ANTHROPIC_API_KEY=
# ANTHROPIC_MODEL=claude-haiku-4-5

# LLM_PROVIDER=ollama
# OLLAMA_MODEL=llama3.1:8b
# OLLAMA_BASE_URL=http://localhost:11434
```

Never commit real keys. `/etc/riskonradar/pipeline.env` on the production droplet must not be committed.

---

## Production Deployment

**Web app:** Cloudflare Workers via `wrangler deploy`. Configuration in `apps/web/wrangler.toml`.

**Pipeline services:** DigitalOcean droplet `164.92.153.187`.

```sh
ssh -i ~/.ssh/riskonradar_do_ed25519 root@164.92.153.187
systemctl status riskonradar-discovery.timer
systemctl status riskonradar-classifier.service
journalctl -u riskonradar-classifier.service -f
```

Queue handoff is database state, not a direct service call. Discovery sets `lifecycle_status = 'pending_classification'`; the classifier polls that column.

---

## Design Principles

- Every suggestion is tied to a source span or explicitly marked as inference — nothing is presented as verified engineering truth.
- Raw paper data (`papers_raw`) and classified knowledge (`knowledge`) are in separate schemas.
- Review state (`review_status` on `fmea_rows`) is stored separately from model output.
- Papers are never hard-deleted; lifecycle state preserves evidence auditability.
- Classifier version, LLM provider, LLM model, and paper input hash are recorded with every classification job for full audit trail.
- Human approval is required before classifier output becomes validated FMEA content.
