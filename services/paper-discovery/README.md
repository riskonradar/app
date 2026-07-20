# Paper Discovery Service

This lightweight service finds candidate engineering literature and stores raw metadata in
`papers_raw`. It never classifies papers or treats search terms as engineering truth.

## Discovery Source

The service searches OpenAlex only. Crossref support was removed (2026-07): papers without abstracts are unclassifiable downstream, and OpenAlex already ingests Crossref metadata with better abstract coverage (reconstructed abstracts).

It filters searches through the trusted ISSNs in `data/journals.json`. Search packs live in
`data/queries.json` and should bias toward recall within those journals.

## Commands

```sh
pip install -e .

# Inspect one query without database writes.
paper-discovery --dry-run --limit 10 --issn 1350-6307 --query "bearing failure"

# Weekly-style incremental sweep with overlap for indexing lag.
paper-discovery --limit 25 --since-days 30

# Refresh citation and open-access metadata for existing candidates.
paper-discovery --backfill-oa --limit 15000
```

Set `DATABASE_URL` (or `SUPABASE_DB_URL`), `DISCOVERY_CONTACT_EMAIL`, and a free
`OPENALEX_API_KEY` for production-scale runs. The OA backfill batches up to 100 DOI lookups
per request and aborts immediately when the daily allowance is exhausted. A watch process
can use `DISCOVERY_HEALTHCHECK_URL`; failed batches exit nonzero and send `/fail`.

## Lifecycle

Raw papers live in `papers_raw.paper_candidates`.

Lifecycle state is tracked with `lifecycle_status`:

```text
discovered -> pending_classification -> classified -> stale -> removed
```

Discovery inserts normal papers as `pending_classification` because they are immediately
eligible for the classifier. It does not hard-delete papers. Rediscovery updates
`last_seen_at`, clears stale/removal timestamps, and restores the appropriate lifecycle.

Changed title/abstract content resets:

```text
classification_status = pending
lifecycle_status = pending_classification
```

The classifier sets both statuses to classified after successful processing. OpenAlex search
results are not an authoritative full snapshot, so discovery never marks unseen papers stale
or removed automatically; that requires an explicit source/retraction verification workflow.

## Dedupe Strategy

Discovery deduplicates in this order:

1. canonical DOI
2. normalized title fingerprint plus publication year
3. normalized abstract hash

The service stores:

- `canonical_doi`
- `title_fingerprint`
- `abstract_hash`
- `external_ids`
- `first_author`
- `first_seen_at`
- `last_seen_at`
- `discovery_score`

DOI-less papers are allowed if they have a strong title fingerprint.

The repository may contain historical import fixtures under `data/ris`; they are not the
production discovery source. Structured evidence extraction belongs to
`services/paper-classifier`.
