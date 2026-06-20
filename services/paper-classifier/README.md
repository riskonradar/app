# Paper Classifier Service

This service is responsible for classifying raw paper candidates into structured reliability knowledge.

Initial responsibilities:

- Read unclassified paper candidates from the raw paper store.
- Classify relevance from title and abstract.
- Extract or propose component, failure mode, cause, effect, control, operating context, citation, confidence, and evidence-span records.
- Write classified records into a separate classified knowledge store or schema.
- Preserve model metadata and review state for auditability.

This service can use a small LLM or classifier pipeline, but classified output should not be treated as validated engineering truth until reviewed.
