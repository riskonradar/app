# Paper Discovery Service

This service is responsible for continuously finding candidate papers and storing raw metadata.

Initial responsibilities:

- Search journal and publisher sources by keywords.
- Store raw paper candidates with DOI, title, abstract, authors, journal, year, source, and fetch metadata.
- Deduplicate candidates before classification.
- Keep raw discovery data separate from classified reliability knowledge.

This service should stay lightweight. It should not classify or validate papers.

## Prototype Data

The current turbofan Zotero RIS export lives at:

```text
data/ris/turbofan-engine.ris
```

This is treated as raw discovered paper metadata. Structured FMEA extraction is handled by `services/paper-classifier`.
