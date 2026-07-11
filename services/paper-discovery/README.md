# Paper Discovery Service

This service is responsible for continuously finding candidate papers and storing raw metadata.

Initial responsibilities:

- Search journal and publisher sources by keywords.
- Store raw paper candidates with DOI, title, abstract, authors, journal, year, source, and fetch metadata.
- Deduplicate candidates before classification.
- Keep raw discovery data separate from classified reliability knowledge.

This service should stay lightweight. It should not classify or validate papers.

## Discovery Source

The service searches OpenAlex only. Crossref support was removed (2026-07): papers without abstracts are unclassifiable downstream, and OpenAlex already ingests Crossref metadata with better abstract coverage (reconstructed abstracts).

It filters the API searches through `data/journals.json`, which is the trusted source list. The current journal list is already treated as trusted; do not add noisy sources without a clear reason.

## Search Queries

`data/queries.json` contains broad discovery search strings. These are query packs for finding candidate papers, not extraction truth.

The classifier later decides whether a paper actually contains useful FMEA evidence. Discovery should bias toward recall while staying inside trusted journals.

## Lifecycle

Raw papers live in `papers_raw.paper_candidates`.

Lifecycle state is tracked with `lifecycle_status`:

```text
discovered -> pending_classification -> classified -> stale -> removed
```

Discovery inserts normal papers as `pending_classification` because they are immediately eligible for the classifier. The `discovered` status is available for source-only staging flows. Discovery does not hard-delete papers. Every time a source sees a paper again, the service updates `last_seen_at`, clears `stale_at`/`removed_at`, and keeps or restores the lifecycle state. Use `--mark-stale-days N` to mark old papers stale after a run, and `--mark-removed-days N` to soft-remove papers that have stayed stale.

Changed title/abstract content resets:

```text
classification_status = pending
lifecycle_status = pending_classification
```

The classifier sets both statuses to classified after successful processing.

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

## Prototype Data

The current turbofan Zotero RIS export lives at:

```text
data/ris/turbofan-engine.ris
```

This is treated as raw discovered paper metadata. Structured FMEA extraction is handled by `services/paper-classifier`.
