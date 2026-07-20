# Paper Classifier Service

This service is responsible for classifying raw paper candidates into structured reliability knowledge.

Initial responsibilities:

- Read unclassified paper candidates from the raw paper store.
- Classify relevance from title/abstract and a license-approved OA full text when available.
- Extract or propose component, failure mode, cause, effect, control, operating context, citation, confidence, and evidence-span records.
- Write classified records into a separate classified knowledge store or schema.
- Preserve model metadata and review state for auditability.

This service can use a small LLM or classifier pipeline, but classified output should not be treated as validated engineering truth until reviewed.

## Data Model

The classifier writes to Supabase Postgres. Raw papers stay in `papers_raw.paper_candidates`.
Machine output is stored as atomic claims in the `knowledge` schema:

- `knowledge.classification_jobs`: one auditable run for a paper input hash and classifier version.
- `knowledge.evidence_claims`: one extracted component, failure mode, cause, effect, control, context, or similar claim.
- `knowledge.evidence_spans`: source text supporting a claim.
- `knowledge.claim_relationships`: machine-proposed links between claims from the same paper.

Claims use separate support types:

- `direct_span`: the value is directly present in the source title, abstract, full text, or metadata.
- `inferred_from_span`: the value is inferred from one or more direct spans and must include an inference rationale.

Unsupported claims should not be stored.

## Environment

Set one of:

```sh
DATABASE_URL=postgresql://...
SUPABASE_DB_URL=postgresql://...
```

The service needs a database role that can read/write `papers_raw` and `knowledge`.

Optional LLM extraction:

```sh
LLM_PROVIDER=gemini
GEMINI_API_KEY=...
GEMINI_MODEL=gemini-2.5-flash-lite
```

Other supported providers:

```sh
LLM_PROVIDER=ollama
OLLAMA_MODEL=llama3.1:8b
OLLAMA_BASE_URL=http://localhost:11434

LLM_PROVIDER=openai
OPENAI_API_KEY=...
OPENAI_MODEL=gpt-5.4-nano

LLM_PROVIDER=anthropic
ANTHROPIC_API_KEY=...
ANTHROPIC_MODEL=claude-haiku-4-5
```

If `LLM_PROVIDER` is unset or `none`, the service uses the deterministic keyword/span extractor.

The optional aggregate reasoner has separate, explicit configuration and never falls back to
the extraction model:

```sh
REASONING_LLM_PROVIDER=anthropic
REASONING_LLM_MODEL=claude-sonnet-model-id
REASONING_LLM_API_KEY=...
```

## Commands

Import the current SQLite corpus into Supabase:

```sh
paper-classifier import-corpus --corpus-db /path/to/corpus.db --limit 100
```

Classify pending papers:

```sh
paper-classifier classify --mode backfill --limit 100 --extractor auto
```

Run continuously beside paper discovery:

```sh
paper-classifier classify --mode incremental --limit 50 --extractor auto --watch --interval-seconds 60
```

Use `--dry-run` on either command to inspect behavior without writing.

Preview the bounded, tenant-scoped system/evidence manifest without calling a model:

```sh
paper-classifier reason-system \
  --organization-id ORGANIZATION_UUID \
  --asset-id ASSET_UUID
```

After reviewing the printed manifest hash and counts, make the opt-in stronger-model call:

```sh
paper-classifier reason-system \
  --organization-id ORGANIZATION_UUID \
  --asset-id ASSET_UUID \
  --max-claims 200 \
  --execute
```

This stage reads only the selected tenant's component instances, dependencies, accepted failure
propagations, and tenant-accepted evidence. It stores auditable jobs and `needs_review`
suggestions in `app.reasoning_jobs` and `app.reasoning_suggestions`. Suggestions may cite only
IDs in the immutable input manifest and never update FMEA rows, assets, component instances, or
accepted propagation records. Re-running the same input/provider/model/prompt version is
idempotent. A failed job is retried only with `--retry-failed`, up to three total attempts.

`classify` reads from `papers_raw.paper_candidates`; it does not need the SQLite corpus once papers are already in Supabase. It selects papers that are pending/failed, plus papers that do not have a completed `knowledge.classification_jobs` row for the current classifier version/model. Deleted paper candidates cascade-delete their classifier jobs, claims, spans, relationships, and legacy classification rows through foreign keys.

## Current Classifier

The service supports two extractors:

- `llm`: asks the configured provider to return structured JSON claims.
- `keyword`: deterministic keyword/span preprocessor.
- `auto`: uses `llm` when configured, otherwise `keyword`.

The deterministic extractor is intentionally conservative:

- finds known component, failure, cause, control, environment, and context terms;
- stores exact spans for direct claims;
- stores inferred claims separately with `support_type='inferred_from_span'`;
- proposes low-confidence relationships for review.

The LLM extractor writes to the same tables. Direct LLM claims are accepted only when their `evidence_text` is found in the named title, abstract, or full-text source. Inferred LLM claims and relationships must still include verified source evidence text and an inference rationale.
