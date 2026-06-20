-- knowledge.evidence_records was an early design artifact (flat FMEA row schema)
-- superseded by the atomic claims approach (evidence_claims + claim_relationships).
-- It was never populated. Dropped to avoid confusion.
drop table if exists knowledge.evidence_records;
