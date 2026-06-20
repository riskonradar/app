# Paper Classifier Service

This service is responsible for classifying raw paper candidates into structured reliability knowledge.

Initial responsibilities:

- Read unclassified paper candidates from the raw paper store.
- Classify relevance from title and abstract.
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

## Commands

Import the current SQLite corpus into Supabase:

```sh
paper-classifier import-corpus --corpus-db /path/to/corpus.db --limit 100
```

Classify pending papers:

```sh
paper-classifier classify --mode backfill --limit 100
```

Use `--dry-run` on either command to inspect behavior without writing.

## Current Classifier

The first implementation is a deterministic keyword/span preprocessor. It is intentionally conservative:

- finds known component, failure, cause, control, environment, and context terms;
- stores exact spans for direct claims;
- stores inferred claims separately with `support_type='inferred_from_span'`;
- proposes low-confidence relationships for review.

The later LLM extractor should write to the same tables rather than replacing the provenance model.
