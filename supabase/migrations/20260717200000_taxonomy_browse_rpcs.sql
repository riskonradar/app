-- Browse RPCs for the analysis-method and application taxonomies.
--
-- knowledge.analysis_methods and knowledge.applications (added in
-- 20260717120000_extend_evidence_taxonomies.sql) share the schema, linker, and
-- inbox pattern of components/failure modes, but had no browse RPC equivalent
-- to public.get_component_taxonomy / public.get_failure_mode_taxonomy. This
-- migration closes that gap so the web app can browse all four taxonomies.

CREATE OR REPLACE FUNCTION public.get_analysis_method_taxonomy(
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
      FROM knowledge.analysis_methods child
      WHERE child.parent_id = node.id AND child.is_active = true
    ) AS child_count,
    (
      SELECT COUNT(*)
      FROM knowledge.claim_analysis_method_links link
      JOIN knowledge.analysis_methods subtree
        ON subtree.id = link.analysis_method_id
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
  FROM knowledge.analysis_methods node
  WHERE auth.role() IN ('authenticated', 'service_role')
    AND node.is_active = true
    AND (
      (p_parent_slug IS NULL AND node.parent_id IS NULL)
      OR node.parent_id = (
        SELECT parent.id
        FROM knowledge.analysis_methods parent
        WHERE parent.slug = p_parent_slug AND parent.is_active = true
      )
    )
  ORDER BY linked_claim_count DESC, node.name;
$$;

CREATE OR REPLACE FUNCTION public.get_application_taxonomy(
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
      FROM knowledge.applications child
      WHERE child.parent_id = node.id AND child.is_active = true
    ) AS child_count,
    (
      SELECT COUNT(*)
      FROM knowledge.claim_application_links link
      JOIN knowledge.applications subtree
        ON subtree.id = link.application_id
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
  FROM knowledge.applications node
  WHERE auth.role() IN ('authenticated', 'service_role')
    AND node.is_active = true
    AND (
      (p_parent_slug IS NULL AND node.parent_id IS NULL)
      OR node.parent_id = (
        SELECT parent.id
        FROM knowledge.applications parent
        WHERE parent.slug = p_parent_slug AND parent.is_active = true
      )
    )
  ORDER BY linked_claim_count DESC, node.name;
$$;

REVOKE ALL ON FUNCTION public.get_analysis_method_taxonomy(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_application_taxonomy(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_analysis_method_taxonomy(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_application_taxonomy(text) TO authenticated, service_role;
