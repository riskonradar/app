-- The atomic classification_jobs/evidence_claims model superseded this empty
-- coarse summary table. Keep the table for migration compatibility, but make
-- its retirement explicit and leave it inaccessible to product clients.

DROP POLICY IF EXISTS "open read paper_classifications"
  ON knowledge.paper_classifications;
DROP POLICY IF EXISTS "authenticated read paper_classifications"
  ON knowledge.paper_classifications;

REVOKE ALL ON TABLE knowledge.paper_classifications FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE knowledge.paper_classifications IS
  'RETIRED: legacy coarse classification summary. Use knowledge.classification_jobs and knowledge.evidence_claims; no application or pipeline code writes this table.';
