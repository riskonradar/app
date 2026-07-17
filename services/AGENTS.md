# Risk on Radar Pipeline Services

This directory contains the background pipeline services for Risk on Radar. These are product services, not marketing-site code.

Risk on Radar is an evidence-backed FMEA intelligence platform. The pipeline exists to continuously find engineering failure literature, normalize raw paper metadata, extract reliability evidence, and store auditable knowledge that the frontend can cite.

## Service Boundary

There are two approved services:

- `paper-discovery`: lightweight discovery service. It searches trusted literature APIs and writes raw paper candidates to Supabase.
- `paper-classifier`: heavier classification service. It reads pending paper candidates, extracts atomic reliability evidence, and writes claims/spans/relationships to Supabase.

Do not add a general-purpose backend service here without explicit user approval. The web app backend stays in `apps/web`; these services are background pipeline concerns.

## Production Flow

The pipeline handoff is database-driven:

```text
paper-discovery
  -> papers_raw.paper_candidates.lifecycle_status = 'pending_classification'
  -> paper-classifier polls pending rows
  -> knowledge.evidence_claims / evidence_spans / claim_relationships
  -> papers_raw.paper_candidates.lifecycle_status = 'classified'
```

Discovery does not directly call the classifier. The shared queue state in Supabase is the contract between them.

## Supabase Schemas

The product database is Supabase Postgres. Always schema-qualify product queries.

- `papers_raw.discovery_runs`: one row per discovery/backfill/import run.
- `papers_raw.paper_candidates`: source-of-record for raw paper metadata before classification.
- `knowledge.classification_jobs`: one auditable classifier attempt for a paper input hash and classifier version.
- `knowledge.evidence_claims`: one atomic extracted or inferred reliability claim.
- `knowledge.evidence_spans`: exact source text supporting a claim.
- `knowledge.claim_relationships`: links between claims from the same paper.
- `papers_raw.paper_full_texts`: append-only licensed-PDF retrieval audit and bounded extracted text.
- `app.reasoning_jobs` / `app.reasoning_suggestions`: optional aggregate-system reasoning
  inputs and review-only outputs; these must never mutate system or FMEA truth.

The frontend should usually read from `knowledge` for product workflows and join back to `papers_raw.paper_candidates` for citation/source drill-downs.

## Paper Lifecycle

`papers_raw.paper_candidates.lifecycle_status` is the pipeline lifecycle:

```text
discovered -> pending_classification -> classified -> stale -> removed
```

Current behavior:

- Discovery inserts normal API results as `pending_classification` because they are immediately eligible for the classifier.
- `discovered` is reserved for future source-only staging/import flows.
- A successful classifier run sets both `classification_status='classified'` and `lifecycle_status='classified'`.
- Re-discovering a stale/removed paper clears `stale_at` and `removed_at`.
- If rediscovered title/abstract content changed, reset `classification_status='pending'` and `lifecycle_status='pending_classification'`.
- Do not hard-delete papers from routine discovery. Use `stale` and `removed` so evidence remains auditable.

## Dedupe Contract

Discovery deduplicates in this order:

1. `canonical_doi`
2. `title_fingerprint` plus `publication_year`
3. `abstract_hash`

Runtime normalization lives in `paper-discovery/src/paper_discovery/dedupe.py`. The Supabase migration backfills equivalent fields. Keep those rules aligned if changing dedupe behavior.

Do not add strict unique constraints for title/hash dedupe until existing duplicate rows have been audited and merged.

## Evidence Rules

Evidence-backed behavior is non-negotiable:

- Every extracted field must have an evidence span or be marked as inference.
- `support_type='direct_span'` means the claim value is directly supported by source text.
- `support_type='inferred_from_span'` means the claim is inferred from source text and must include `inference_rationale`.
- Unsupported LLM output should be dropped rather than stored.
- Never present classifier output as validated engineering truth until review state says it has been accepted.
- Preserve classifier version, model/provider, paper input hash, source paper ID, confidence, and review status.

## Discovery Service

Path: `services/paper-discovery`

Main responsibilities:

- Search OpenAlex (sole source; Crossref removed 2026-07 — abstract-less papers are unclassifiable, and OpenAlex ingests Crossref data).
- Restrict discovery to trusted ISSNs from `data/journals.json`.
- Use broad search query packs from `data/queries.json`.
- Upsert raw metadata into `papers_raw.paper_candidates`.
- Track discovery run metadata in `papers_raw.discovery_runs`.
- Mark old papers stale/removed without deleting them.

Important clarification: query packs are only search filters. They are not extraction truth and do not classify papers. The classifier decides whether a paper contains useful FMEA evidence.

Common commands:

```sh
cd services/paper-discovery
pip install -e .
paper-discovery --help
paper-discovery --limit 100
paper-discovery --dry-run --limit 10 --issn 1350-6307 --query "bearing failure"
paper-discovery --limit 25 --since-days 30
```

Environment:

```sh
DATABASE_URL=postgresql://...
# or
SUPABASE_DB_URL=postgresql://...

DISCOVERY_CONTACT_EMAIL=you@example.com
```

## Classifier Service

Path: `services/paper-classifier`

Main responsibilities:

- Poll `papers_raw.paper_candidates` for pending/failed or unprocessed papers.
- Extract reliability/FMEA claims from title/abstract and explicitly licensed full text.
- Store atomic claims, evidence spans, relationships, model metadata, and confidence.
- Mark successfully processed papers as classified.
- Link supported claims to database-owned component, failure-mode, analysis-method, and
  application taxonomies after each batch.

Production should use LLM-only mode when claiming LLM extraction quality:

```sh
paper-classifier classify --extractor llm --limit 25 --mode incremental --watch --interval-seconds 300 --workers 1
```

`--extractor auto` can fall back to keyword extraction. That is useful for local development, but avoid it in production if keyword fallback would be mistaken for LLM output.

Supported provider env vars:

```sh
LLM_PROVIDER=gemini
GEMINI_API_KEY=...
GEMINI_MODEL=gemini-2.5-flash-lite

LLM_PROVIDER=groq
GROQ_API_KEY=...
GROQ_MODEL=llama-3.3-70b-versatile

LLM_PROVIDER=openai
OPENAI_API_KEY=...
OPENAI_MODEL=gpt-5.4-nano

LLM_PROVIDER=anthropic
ANTHROPIC_API_KEY=...
ANTHROPIC_MODEL=claude-haiku-4-5
```

One-off helpers:

```sh
paper-classifier import-corpus --corpus-db /path/to/corpus.db
paper-classifier import-easa
paper-classifier ingest-full-text --limit 100
paper-classifier link-taxonomy
paper-classifier classify --extractor keyword --limit 1 --dry-run
paper-classifier reason-system --organization-id UUID --asset-id UUID
```

`reason-system` is preview-only unless `--execute` is passed. Execution requires the
separate `REASONING_LLM_*` environment variables and writes auditable suggestions for human
review; it does not update system edges or FMEA rows.

Model or prompt changes must use the fixed evaluation sample and completed human annotations:

```sh
paper-classifier eval-validate \
  --sample evaluation/sample-v1.jsonl \
  --annotations evaluation/annotations-v1.jsonl
paper-classifier eval-run --sample evaluation/sample-v1.jsonl --model MODEL --output predictions.jsonl
paper-classifier eval-score \
  --sample evaluation/sample-v1.jsonl \
  --annotations evaluation/annotations-v1.jsonl \
  --predictions predictions.jsonl \
  --output scores.json
```

## Droplet Deployment Target

The pipeline is deployed on a DigitalOcean droplet:

```text
Host: 164.92.153.187
SSH key: ~/.ssh/riskonradar_do_ed25519
App dir: /opt/riskonradar
Venv: /opt/riskonradar/venv
Env file: /etc/riskonradar/pipeline.env
```

Do not commit secrets from `/etc/riskonradar/pipeline.env`.

Systemd units:

- `riskonradar-discovery.timer`: enabled weekly discovery timer.
- `riskonradar-discovery.service`: oneshot discovery run.
- `riskonradar-classifier.service`: long-running classifier worker.
- `riskonradar-full-text.timer`: weekly OA metadata and licensed full-text ingestion.

Current intended commands:

```sh
# Weekly discovery, via timer
/opt/riskonradar/venv/bin/paper-discovery --limit 25 --since-days 30

# Continuous classifier worker
/opt/riskonradar/venv/bin/paper-classifier classify --extractor llm --limit 25 --mode incremental --watch --interval-seconds 300 --workers 1
```

Useful operations:

```sh
ssh -i ~/.ssh/riskonradar_do_ed25519 root@164.92.153.187
systemctl status riskonradar-discovery.timer
systemctl status riskonradar-classifier.service
journalctl -u riskonradar-discovery.service -f
journalctl -u riskonradar-classifier.service -f
systemctl restart riskonradar-classifier.service
```

## Deployment Notes

The droplet uses a copied snapshot under `/opt/riskonradar`, not an automated git checkout.
Repository state does not prove deployment state: verify unit files, `systemctl`, logs,
database connectivity, and classifier-version rows after every rollout.

Keep the production worker conservative:

- Weekly discovery is enough for now.
- Classifier polling every 5 minutes is enough for now.
- `--workers 1` protects low-cost LLM quotas.
- Let LLM quota/provider errors fail visibly and retry later; never label deterministic
  fallback output as an LLM job.

## Testing

Focused local tests:

```sh
cd services/paper-discovery
PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=src python3 -m unittest discover -s tests

cd services/paper-classifier
PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=src python3 -m unittest discover -s tests
```

Use dry-run commands before broad ingestion/classification when changing query packs, dedupe, or extractor behavior.
