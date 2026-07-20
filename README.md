# Risk on Radar

Risk on Radar is an authenticated, evidence-backed FMEA and system-risk workspace for
reliability and quality engineering teams. It turns scientific literature and regulatory
evidence into reviewable engineering claims, exact source spans, typed relationships, and
traceable FMEA rows.

The public website and whitepaper live at https://riskonradar.com/. This repository is the
product application and its ingestion services, not the marketing site.

## Product Surfaces

- `/fmea`: taxonomy-aware live evidence search, engineer-owned S/O/D ratings, review state,
  exact evidence spans, citations, transactional saves, audit history, and CSV/XLSX export.
- `/systems`: tenant-defined system trees, component-taxonomy references, dependencies,
  reviewed failure-propagation edges, cascade analysis, and change history.
- `/account` and `/organization`: personal/team workspaces, Clerk membership management,
  role enforcement, seats, and Stripe billing lifecycle.
- `/admin`: bookmark-only internal pipeline view. Access is hidden with `notFound()` unless
  the signed-in primary email is listed in `ADMIN_EMAILS`.

Do not put database counts in documentation. They change continuously. Use `/admin` or
schema-qualified database queries for current paper, job, claim, span, and relationship
counts.

## Architecture

```text
OpenAlex / EASA / corpus imports
          |
          v
papers_raw.paper_candidates
          |
          v
knowledge.classification_jobs
knowledge.evidence_claims
knowledge.evidence_spans
knowledge.claim_relationships
          |
          v
Next.js product workflows -> app.fmea_* / app.asset_*
```

- `apps/web`: Next.js 16, Clerk, Supabase service-role server access, Stripe Billing,
  and a Railway-ready standalone Node deployment.
- `services/paper-discovery`: OpenAlex-only discovery with trusted ISSNs, deduplication,
  lifecycle-state preservation, citation metadata, and open-access metadata backfill.
- `services/paper-classifier`: auditable LLM extraction, legal OA full-text ingestion,
  taxonomy linking, a fixed-sample model-evaluation harness, and an optional aggregate
  system-reasoning stage whose outputs remain review-only suggestions.
- `supabase/migrations`: schema, RLS, RPCs, taxonomy, billing, FMEA, and system-model changes.

The web server deliberately uses the Supabase service role at this stage. Every product
route first resolves the Clerk user and active workspace, scopes reads by organization, and
checks roles before mutations. Clerk-to-Supabase end-user JWT bridging is not implemented.
That is a documented MVP boundary, not permission to omit route-level workspace checks.

## Evidence Pipeline

### Discovery

`paper-discovery` searches OpenAlex only. Query packs are broad recall filters; they do not
classify engineering truth. Candidates are deduplicated by canonical DOI, title fingerprint
plus year, then abstract hash. Routine jobs never hard-delete evidence.

```sh
cd services/paper-discovery
pip install -e .
paper-discovery --dry-run --limit 10 --issn 1350-6307 --query "bearing failure"
paper-discovery --backfill-oa --limit 15000
```

### Full Text

`paper-classifier ingest-full-text` only fetches public HTTPS PDFs with an explicit `CC-BY`,
`CC0`, or public-domain license. It rejects private-network targets, non-PDF responses,
oversized/encrypted files, and unsafe redirects. PDF bytes are hashed and discarded; bounded
extracted text and retrieval provenance are retained.

```sh
cd services/paper-classifier
pip install -e .
paper-classifier ingest-full-text --limit 100
```

### Classification

The code classifier prefix is `llm-extractor-v5`. A complete job version also includes the
provider and model. Never infer the active production model from this file: query
`knowledge.classification_jobs` and inspect `classifier_version` plus
`classifier_metadata`. The production worker must use `--extractor llm`.

Direct claims are kept only when their evidence text is found in the declared title,
abstract, or licensed full-text source. Inferred claims require both supporting evidence and
an inference rationale. Invalid claims and relationships are dropped. New machine claims
remain unverified until an engineer reviews them.

```sh
paper-classifier classify \
  --extractor llm \
  --mode incremental \
  --limit 25 \
  --workers 1 \
  --watch \
  --interval-seconds 300

paper-classifier link-taxonomy
```

Shared hierarchical taxonomies currently cover components, failure modes, analysis methods,
and applications. Linking is deterministic: exact name, alias, trigram fuzzy match, then an
unresolved taxonomy inbox. Causes, effects, and controls remain evidence-preserving free text
because the audited corpus did not show a stable closed vocabulary for them.

## Local Development

Prerequisites: Node.js, pnpm, Python 3.12+, and the environment values in `.env.example`.

```sh
pnpm install
pnpm dev:web
pnpm lint:web
pnpm test:web
pnpm build:web
```

```sh
cd services/paper-discovery
PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=src python3 -m unittest discover -s tests

cd ../paper-classifier
PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=src python3 -m unittest discover -s tests
```

Never commit real values for Clerk, Supabase, Stripe, LLM providers, `ADMIN_EMAILS`, database
URLs, or healthcheck endpoints.

Production pipeline services connect through the dedicated `riskonradar_pipeline` runtime
role. Its login password is generated and installed out-of-band; it never belongs in a
migration, repository file, or command transcript.

## Database Changes

Always schema-qualify product SQL. Validate and apply migrations from the repository root:

```sh
supabase migration list --linked
supabase db push --linked --dry-run --include-all
supabase db push --linked --include-all
```

Routine app code must never query the retired `knowledge.paper_classifications`, the empty
legacy `knowledge.evidence_records`, or the removed turbofan-only RPC.

## Production Services

Pipeline systemd definitions are versioned in `services/deploy/systemd/`:

- `riskonradar-discovery.timer`: weekly incremental OpenAlex discovery.
- `riskonradar-classifier.service`: continuous LLM-only classification.
- `riskonradar-full-text.timer`: weekly OA metadata and licensed full-text ingestion.

Each unit supports a Healthchecks-compatible URL through `DISCOVERY_HEALTHCHECK_URL`,
`CLASSIFIER_HEALTHCHECK_URL`, or `FULL_TEXT_HEALTHCHECK_URL`. Monitoring failures never block
the pipeline, while failed work exits nonzero and sends a failure signal.

## Web Deployment (Railway)

The repository root contains the production `Dockerfile` and `railway.toml`. Railway builds the
Next.js standalone server, starts `node apps/web/server.js`, and checks `/api/health`. Configure
the production domain and every required value from `.env.example` in Railway; secrets must never
be Docker build arguments or committed files.

`NEXT_PUBLIC_*` values are declared as Docker build arguments because Next.js inlines them into
browser bundles; configure the same values as Railway service variables. Server-only Clerk,
Supabase service-role, Stripe, and webhook credentials remain runtime variables only.

The previous automatic Cloudflare workflow was removed because the current OpenNext adapter
rejects this app's Node.js Clerk middleware after a successful Next build. Pull requests and main
now run pinned lint/test/build CI instead of attempting a deployment that is known to fail.
Configure Railway to deploy only after the GitHub `CI` check succeeds, and require that check in
main branch protection.

The production service snapshot is `/opt/riskonradar` on `164.92.153.187`; secrets live in
`/etc/riskonradar/pipeline.env`. Deployment is not complete until migrations, service code,
systemd units, backfills, a small classifier canary, and logs have all been verified.

## Commercial Configuration

Stripe products, prices, Tax, webhook signing, and Customer Portal settings are external
configuration. Clerk production keys, organization settings, and webhook signing are also
external. The application fails closed when required secrets are absent. Never invent or
commit live values to make a deployment appear complete.

Team billing uses one base subscription item for the included seats and a separate recurring
extra-seat price for seats above that allowance. Stripe price semantics must match the plan
definitions in `apps/web/src/lib/billing/plans.ts` before checkout is enabled.

## Engineering Rules

- Treat the app as a copilot, never an autopilot.
- Preserve source, exact span, model/version, confidence, review state, and reviewer action.
- Do not claim standards or regulatory compliance that the implementation does not provide.
- Do not merge distinct taxonomy nodes through frontend string normalization.
- Do not expose the Supabase service role or direct database URL to browser code.
- Do not deploy prompt/model changes before the fixed human-annotated evaluation passes.
