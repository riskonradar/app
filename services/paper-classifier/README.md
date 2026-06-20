# Paper Classifier Service

This service is responsible for classifying raw paper candidates into structured reliability knowledge.

Initial responsibilities:

- Read unclassified paper candidates from the raw paper store.
- Classify relevance from title and abstract.
- Extract or propose component, failure mode, cause, effect, control, operating context, citation, confidence, and evidence-span records.
- Write classified records into a separate classified knowledge store or schema.
- Preserve model metadata and review state for auditability.

This service can use a small LLM or classifier pipeline, but classified output should not be treated as validated engineering truth until reviewed.

## Prototype FMEA Classifier

The current turbofan RIS prototype can be regenerated with:

```sh
python -m paper_classifier.main --ris ../paper-discovery/data/ris/turbofan-engine.ris --output data/classified/fmea-turbofan-data.json
```

The generated rows are grouped by component and failure mode, preserve paper citations, and keep severity, occurrence, detection, corrective action, and RPN blank until reviewed or scored by an approved workflow.
