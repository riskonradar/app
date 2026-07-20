-- Prevent overlapping classifier workers from selecting the same paper and
-- make component-subtree counts respect slash-delimited path boundaries.

ALTER TABLE papers_raw.paper_candidates
  ADD COLUMN IF NOT EXISTS classification_lease_token uuid,
  ADD COLUMN IF NOT EXISTS classification_lease_expires_at timestamptz;

CREATE INDEX IF NOT EXISTS paper_candidates_classification_lease_idx
  ON papers_raw.paper_candidates(classification_lease_expires_at)
  WHERE classification_lease_token IS NOT NULL;

CREATE OR REPLACE FUNCTION public.get_component_taxonomy(
  p_parent_slug text DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  name text,
  slug text,
  path text,
  depth smallint,
  is_leaf boolean,
  description text,
  child_count bigint,
  linked_claim_count bigint
)
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT
    node.id,
    node.name,
    node.slug,
    node.path,
    node.depth,
    node.is_leaf,
    node.description,
    (
      SELECT COUNT(*)
      FROM knowledge.components child
      WHERE child.parent_id = node.id AND child.is_active = true
    ) AS child_count,
    (
      SELECT COUNT(*)
      FROM knowledge.claim_component_links link
      JOIN knowledge.components subtree
        ON subtree.id = link.component_id
        AND subtree.is_active = true
        AND (subtree.path = node.path OR subtree.path LIKE node.path || '/%')
      JOIN knowledge.evidence_claims claim
        ON claim.id = link.evidence_claim_id
        AND claim.review_status NOT IN ('rejected', 'superseded')
      JOIN papers_raw.paper_candidates source_paper
        ON source_paper.id = claim.paper_candidate_id
        AND source_paper.lifecycle_status <> 'removed'
      JOIN knowledge.classification_jobs job
        ON job.id = claim.classification_job_id
        AND job.status = 'completed'
        AND job.classifier_metadata->>'extractor' = 'llm'
      WHERE link.review_status != 'rejected'
    ) AS linked_claim_count
  FROM knowledge.components node
  WHERE auth.role() IN ('authenticated', 'service_role')
    AND node.is_active = true
    AND (
      (p_parent_slug IS NULL AND node.parent_id IS NULL)
      OR node.parent_id = (
        SELECT parent.id
        FROM knowledge.components parent
        WHERE parent.slug = p_parent_slug AND parent.is_active = true
      )
    )
  ORDER BY linked_claim_count DESC, node.name;
$$;

REVOKE ALL ON FUNCTION public.get_component_taxonomy(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_component_taxonomy(text) TO authenticated, service_role;
