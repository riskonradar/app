-- Taxonomy-backed FMEA search contracts. Postgres owns alias resolution and
-- canonical IDs; the web app must not maintain a second normalization dictionary.

DROP FUNCTION IF EXISTS public.search_fmea_evidence(text, integer, integer);
DROP FUNCTION IF EXISTS public.search_fmea_by_component(text, text, integer, integer, numeric);
DROP FUNCTION IF EXISTS public.search_fmea_by_failure_mode(text, text, text, integer, integer, numeric);

CREATE OR REPLACE FUNCTION public.resolve_fmea_taxonomy_node(
  p_claim_type text,
  p_query text
)
RETURNS TABLE (
  id uuid,
  claim_type text,
  name text,
  slug text,
  path text
)
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  WITH nodes AS (
    SELECT c.id, 'component'::text AS claim_type, c.name, c.slug, c.path, c.depth, c.aliases
    FROM knowledge.components c
    WHERE p_claim_type = 'component' AND c.is_active = true
    UNION ALL
    SELECT fm.id, 'failure_mode'::text, fm.name, fm.slug, fm.path, fm.depth, fm.aliases
    FROM knowledge.failure_modes fm
    WHERE p_claim_type = 'failure_mode' AND fm.is_active = true
  )
  SELECT n.id, n.claim_type, n.name, n.slug, n.path
  FROM nodes n
  WHERE auth.role() IN ('authenticated', 'service_role')
    AND NULLIF(BTRIM(p_query), '') IS NOT NULL
    AND (
      LOWER(n.name) = LOWER(BTRIM(p_query))
      OR LOWER(n.slug) = LOWER(REGEXP_REPLACE(BTRIM(p_query), '[^a-zA-Z0-9]+', '-', 'g'))
      OR LOWER(BTRIM(p_query)) = ANY (
        SELECT LOWER(alias)
        FROM UNNEST(n.aliases) AS alias
      )
    )
  ORDER BY
    CASE WHEN LOWER(n.name) = LOWER(BTRIM(p_query)) THEN 0
         WHEN LOWER(n.slug) = LOWER(REGEXP_REPLACE(BTRIM(p_query), '[^a-zA-Z0-9]+', '-', 'g')) THEN 1
         ELSE 2
    END,
    n.depth DESC,
    n.name
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.search_fmea_evidence(
  p_query text DEFAULT NULL,
  p_limit integer DEFAULT 100,
  p_offset integer DEFAULT 0
)
RETURNS TABLE (
  failure_mode_claim_id uuid,
  failure_mode_taxonomy_id uuid,
  failure_mode text,
  failure_mode_slug text,
  component_taxonomy_id uuid,
  component text,
  component_slug text,
  cause text,
  effect text,
  control text,
  domain text,
  confidence numeric,
  review_status text,
  doi text,
  title text,
  journal text,
  publication_year integer,
  source text,
  total_count bigint
)
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  WITH base AS (
    SELECT
      fm.id AS failure_mode_claim_id,
      fm_tax.id AS failure_mode_taxonomy_id,
      COALESCE(fm_tax.name, fm.normalized_value, fm.raw_value) AS failure_mode,
      fm_tax.slug AS failure_mode_slug,
      component_tax.id AS component_taxonomy_id,
      COALESCE(component_tax.name, component_claim.normalized_value, component_claim.raw_value) AS component,
      component_tax.slug AS component_slug,
      cause_values.value AS cause,
      effect_values.value AS effect,
      control_values.value AS control,
      domain_values.value AS domain,
      fm.confidence,
      fm.review_status,
      paper.doi,
      paper.title,
      paper.journal,
      paper.publication_year,
      paper.source
    FROM knowledge.evidence_claims fm
    JOIN knowledge.classification_jobs job
      ON job.id = fm.classification_job_id
      AND job.status = 'completed'
      AND job.classifier_metadata->>'extractor' = 'llm'
    JOIN knowledge.claim_relationships has_fm
      ON has_fm.object_claim_id = fm.id
      AND has_fm.relationship_type = 'has_failure_mode'
      AND has_fm.review_status NOT IN ('rejected', 'superseded')
      AND has_fm.classification_job_id = fm.classification_job_id
    JOIN knowledge.evidence_claims component_claim
      ON component_claim.id = has_fm.subject_claim_id
      AND component_claim.claim_type = 'component'
      AND component_claim.review_status NOT IN ('rejected', 'superseded')
    JOIN papers_raw.paper_candidates paper
      ON paper.id = fm.paper_candidate_id
      AND paper.lifecycle_status <> 'removed'
    LEFT JOIN LATERAL (
      SELECT node.id, node.name, node.slug
      FROM knowledge.claim_failure_mode_links link
      JOIN knowledge.failure_modes node ON node.id = link.failure_mode_id AND node.is_active = true
      WHERE link.evidence_claim_id = fm.id AND link.review_status != 'rejected'
      ORDER BY (link.review_status = 'accepted') DESC, link.confidence DESC, node.depth DESC
      LIMIT 1
    ) fm_tax ON true
    LEFT JOIN LATERAL (
      SELECT node.id, node.name, node.slug
      FROM knowledge.claim_component_links link
      JOIN knowledge.components node ON node.id = link.component_id AND node.is_active = true
      WHERE link.evidence_claim_id = component_claim.id AND link.review_status != 'rejected'
      ORDER BY (link.review_status = 'accepted') DESC, link.confidence DESC, node.depth DESC
      LIMIT 1
    ) component_tax ON true
    LEFT JOIN LATERAL (
      SELECT STRING_AGG(DISTINCT COALESCE(claim.normalized_value, claim.raw_value), '; ' ORDER BY COALESCE(claim.normalized_value, claim.raw_value)) AS value
      FROM knowledge.claim_relationships relationship
      JOIN knowledge.evidence_claims claim
        ON claim.id = relationship.object_claim_id
        AND claim.claim_type = 'cause'
        AND claim.review_status NOT IN ('rejected', 'superseded')
      WHERE relationship.subject_claim_id = fm.id
        AND relationship.relationship_type = 'caused_by'
        AND relationship.review_status NOT IN ('rejected', 'superseded')
        AND relationship.classification_job_id = fm.classification_job_id
    ) cause_values ON true
    LEFT JOIN LATERAL (
      SELECT STRING_AGG(DISTINCT COALESCE(claim.normalized_value, claim.raw_value), '; ' ORDER BY COALESCE(claim.normalized_value, claim.raw_value)) AS value
      FROM knowledge.claim_relationships relationship
      JOIN knowledge.evidence_claims claim
        ON claim.id = relationship.object_claim_id
        AND claim.claim_type = 'effect'
        AND claim.review_status NOT IN ('rejected', 'superseded')
      WHERE relationship.subject_claim_id = fm.id
        AND relationship.relationship_type = 'has_effect'
        AND relationship.review_status NOT IN ('rejected', 'superseded')
        AND relationship.classification_job_id = fm.classification_job_id
    ) effect_values ON true
    LEFT JOIN LATERAL (
      SELECT STRING_AGG(DISTINCT COALESCE(claim.normalized_value, claim.raw_value), '; ' ORDER BY COALESCE(claim.normalized_value, claim.raw_value)) AS value
      FROM knowledge.claim_relationships relationship
      JOIN knowledge.evidence_claims claim
        ON claim.id = relationship.object_claim_id
        AND claim.claim_type = 'control'
        AND claim.review_status NOT IN ('rejected', 'superseded')
      WHERE relationship.subject_claim_id = fm.id
        AND relationship.relationship_type = 'mitigated_by'
        AND relationship.review_status NOT IN ('rejected', 'superseded')
        AND relationship.classification_job_id = fm.classification_job_id
    ) control_values ON true
    LEFT JOIN LATERAL (
      SELECT STRING_AGG(DISTINCT COALESCE(claim.normalized_value, claim.raw_value), '; ' ORDER BY COALESCE(claim.normalized_value, claim.raw_value)) AS value
      FROM knowledge.evidence_claims claim
      WHERE claim.paper_candidate_id = fm.paper_candidate_id
        AND claim.classification_job_id = fm.classification_job_id
        AND claim.claim_type = 'application'
        AND claim.review_status NOT IN ('rejected', 'superseded')
    ) domain_values ON true
    WHERE auth.role() IN ('authenticated', 'service_role')
      AND fm.claim_type = 'failure_mode'
      AND fm.review_status NOT IN ('rejected', 'superseded')
      AND (
        p_query IS NULL
        OR COALESCE(component_tax.name, component_claim.normalized_value, component_claim.raw_value) ILIKE '%' || p_query || '%'
        OR COALESCE(fm_tax.name, fm.normalized_value, fm.raw_value) ILIKE '%' || p_query || '%'
      )
  )
  SELECT base.*, COUNT(*) OVER () AS total_count
  FROM base
  ORDER BY confidence DESC NULLS LAST, publication_year DESC NULLS LAST, failure_mode_claim_id
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 100), 1), 500)
  OFFSET GREATEST(COALESCE(p_offset, 0), 0);
$$;

CREATE OR REPLACE FUNCTION public.search_fmea_by_component(
  p_component_slug text,
  p_domain text DEFAULT NULL,
  p_limit integer DEFAULT 100,
  p_offset integer DEFAULT 0,
  p_min_confidence numeric DEFAULT 0.0
)
RETURNS TABLE (
  failure_mode_claim_id uuid,
  failure_mode_taxonomy_id uuid,
  failure_mode text,
  failure_mode_slug text,
  component_taxonomy_id uuid,
  component text,
  component_slug text,
  cause text,
  effect text,
  control text,
  domain text,
  confidence numeric,
  review_status text,
  doi text,
  title text,
  journal text,
  publication_year integer,
  source text,
  total_count bigint
)
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  WITH target AS (
    SELECT node.path
    FROM knowledge.components node
    WHERE node.slug = p_component_slug AND node.is_active = true
  ),
  matched AS (
    SELECT DISTINCT ON (has_fm.id)
      fm.id AS failure_mode_claim_id,
      component_node.id AS component_taxonomy_id,
      component_node.name AS component,
      component_node.slug AS component_slug,
      fm.paper_candidate_id,
      fm.classification_job_id,
      fm.normalized_value,
      fm.raw_value,
      fm.confidence,
      fm.review_status
    FROM target
    JOIN knowledge.components component_node
      ON component_node.is_active = true
      AND (component_node.path = target.path OR component_node.path LIKE target.path || '/%')
    JOIN knowledge.claim_component_links component_link
      ON component_link.component_id = component_node.id
      AND component_link.review_status != 'rejected'
    JOIN knowledge.evidence_claims component_claim
      ON component_claim.id = component_link.evidence_claim_id
      AND component_claim.claim_type = 'component'
      AND component_claim.review_status NOT IN ('rejected', 'superseded')
    JOIN knowledge.classification_jobs job
      ON job.id = component_claim.classification_job_id
      AND job.status = 'completed'
      AND job.classifier_metadata->>'extractor' = 'llm'
    JOIN knowledge.claim_relationships has_fm
      ON has_fm.subject_claim_id = component_claim.id
      AND has_fm.relationship_type = 'has_failure_mode'
      AND has_fm.review_status NOT IN ('rejected', 'superseded')
      AND has_fm.classification_job_id = component_claim.classification_job_id
    JOIN knowledge.evidence_claims fm
      ON fm.id = has_fm.object_claim_id
      AND fm.claim_type = 'failure_mode'
      AND fm.review_status NOT IN ('rejected', 'superseded')
      AND fm.confidence >= COALESCE(p_min_confidence, 0)
    WHERE auth.role() IN ('authenticated', 'service_role')
    ORDER BY has_fm.id, (component_link.review_status = 'accepted') DESC, component_link.confidence DESC, component_node.depth DESC
  ),
  base AS (
    SELECT
      matched.failure_mode_claim_id,
      fm_tax.id AS failure_mode_taxonomy_id,
      COALESCE(fm_tax.name, matched.normalized_value, matched.raw_value) AS failure_mode,
      fm_tax.slug AS failure_mode_slug,
      matched.component_taxonomy_id,
      matched.component,
      matched.component_slug,
      cause_values.value AS cause,
      effect_values.value AS effect,
      control_values.value AS control,
      domain_values.value AS domain,
      matched.confidence,
      matched.review_status,
      paper.doi,
      paper.title,
      paper.journal,
      paper.publication_year,
      paper.source
    FROM matched
    JOIN papers_raw.paper_candidates paper
      ON paper.id = matched.paper_candidate_id
      AND paper.lifecycle_status <> 'removed'
    LEFT JOIN LATERAL (
      SELECT node.id, node.name, node.slug
      FROM knowledge.claim_failure_mode_links link
      JOIN knowledge.failure_modes node ON node.id = link.failure_mode_id AND node.is_active = true
      WHERE link.evidence_claim_id = matched.failure_mode_claim_id AND link.review_status != 'rejected'
      ORDER BY (link.review_status = 'accepted') DESC, link.confidence DESC, node.depth DESC
      LIMIT 1
    ) fm_tax ON true
    LEFT JOIN LATERAL (
      SELECT STRING_AGG(DISTINCT COALESCE(claim.normalized_value, claim.raw_value), '; ' ORDER BY COALESCE(claim.normalized_value, claim.raw_value)) AS value
      FROM knowledge.claim_relationships relationship
      JOIN knowledge.evidence_claims claim ON claim.id = relationship.object_claim_id AND claim.claim_type = 'cause' AND claim.review_status NOT IN ('rejected', 'superseded')
      WHERE relationship.subject_claim_id = matched.failure_mode_claim_id AND relationship.relationship_type = 'caused_by'
        AND relationship.review_status NOT IN ('rejected', 'superseded') AND relationship.classification_job_id = matched.classification_job_id
    ) cause_values ON true
    LEFT JOIN LATERAL (
      SELECT STRING_AGG(DISTINCT COALESCE(claim.normalized_value, claim.raw_value), '; ' ORDER BY COALESCE(claim.normalized_value, claim.raw_value)) AS value
      FROM knowledge.claim_relationships relationship
      JOIN knowledge.evidence_claims claim ON claim.id = relationship.object_claim_id AND claim.claim_type = 'effect' AND claim.review_status NOT IN ('rejected', 'superseded')
      WHERE relationship.subject_claim_id = matched.failure_mode_claim_id AND relationship.relationship_type = 'has_effect'
        AND relationship.review_status NOT IN ('rejected', 'superseded') AND relationship.classification_job_id = matched.classification_job_id
    ) effect_values ON true
    LEFT JOIN LATERAL (
      SELECT STRING_AGG(DISTINCT COALESCE(claim.normalized_value, claim.raw_value), '; ' ORDER BY COALESCE(claim.normalized_value, claim.raw_value)) AS value
      FROM knowledge.claim_relationships relationship
      JOIN knowledge.evidence_claims claim ON claim.id = relationship.object_claim_id AND claim.claim_type = 'control' AND claim.review_status NOT IN ('rejected', 'superseded')
      WHERE relationship.subject_claim_id = matched.failure_mode_claim_id AND relationship.relationship_type = 'mitigated_by'
        AND relationship.review_status NOT IN ('rejected', 'superseded') AND relationship.classification_job_id = matched.classification_job_id
    ) control_values ON true
    LEFT JOIN LATERAL (
      SELECT STRING_AGG(DISTINCT COALESCE(claim.normalized_value, claim.raw_value), '; ' ORDER BY COALESCE(claim.normalized_value, claim.raw_value)) AS value
      FROM knowledge.evidence_claims claim
      WHERE claim.paper_candidate_id = matched.paper_candidate_id AND claim.classification_job_id = matched.classification_job_id
        AND claim.claim_type = 'application' AND claim.review_status NOT IN ('rejected', 'superseded')
    ) domain_values ON true
    WHERE p_domain IS NULL OR domain_values.value ILIKE '%' || p_domain || '%'
  )
  SELECT base.*, COUNT(*) OVER () AS total_count
  FROM base
  ORDER BY confidence DESC NULLS LAST, publication_year DESC NULLS LAST, failure_mode_claim_id
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 100), 1), 500)
  OFFSET GREATEST(COALESCE(p_offset, 0), 0);
$$;

CREATE OR REPLACE FUNCTION public.search_fmea_by_failure_mode(
  p_failure_mode_slug text,
  p_component_slug text DEFAULT NULL,
  p_domain text DEFAULT NULL,
  p_limit integer DEFAULT 100,
  p_offset integer DEFAULT 0,
  p_min_confidence numeric DEFAULT 0.0
)
RETURNS TABLE (
  failure_mode_claim_id uuid,
  failure_mode_taxonomy_id uuid,
  failure_mode text,
  failure_mode_slug text,
  component_taxonomy_id uuid,
  component text,
  component_slug text,
  cause text,
  effect text,
  control text,
  domain text,
  confidence numeric,
  review_status text,
  doi text,
  title text,
  journal text,
  publication_year integer,
  source text,
  total_count bigint
)
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  WITH failure_target AS (
    SELECT node.path
    FROM knowledge.failure_modes node
    WHERE node.slug = p_failure_mode_slug AND node.is_active = true
  ),
  component_target AS (
    SELECT node.path
    FROM knowledge.components node
    WHERE node.slug = p_component_slug AND node.is_active = true
  ),
  matched AS (
    SELECT DISTINCT ON (has_fm.id)
      fm.id AS failure_mode_claim_id,
      failure_node.id AS failure_mode_taxonomy_id,
      failure_node.name AS failure_mode,
      failure_node.slug AS failure_mode_slug,
      component_tax.id AS component_taxonomy_id,
      COALESCE(component_tax.name, component_claim.normalized_value, component_claim.raw_value) AS component,
      component_tax.slug AS component_slug,
      fm.paper_candidate_id,
      fm.classification_job_id,
      fm.confidence,
      fm.review_status
    FROM failure_target
    JOIN knowledge.failure_modes failure_node
      ON failure_node.is_active = true
      AND (failure_node.path = failure_target.path OR failure_node.path LIKE failure_target.path || '/%')
    JOIN knowledge.claim_failure_mode_links failure_link
      ON failure_link.failure_mode_id = failure_node.id
      AND failure_link.review_status != 'rejected'
    JOIN knowledge.evidence_claims fm
      ON fm.id = failure_link.evidence_claim_id
      AND fm.claim_type = 'failure_mode'
      AND fm.review_status NOT IN ('rejected', 'superseded')
      AND fm.confidence >= COALESCE(p_min_confidence, 0)
    JOIN knowledge.classification_jobs job
      ON job.id = fm.classification_job_id
      AND job.status = 'completed'
      AND job.classifier_metadata->>'extractor' = 'llm'
    JOIN knowledge.claim_relationships has_fm
      ON has_fm.object_claim_id = fm.id
      AND has_fm.relationship_type = 'has_failure_mode'
      AND has_fm.review_status NOT IN ('rejected', 'superseded')
      AND has_fm.classification_job_id = fm.classification_job_id
    JOIN knowledge.evidence_claims component_claim
      ON component_claim.id = has_fm.subject_claim_id
      AND component_claim.claim_type = 'component'
      AND component_claim.review_status NOT IN ('rejected', 'superseded')
    LEFT JOIN LATERAL (
      SELECT node.id, node.name, node.slug, node.path
      FROM knowledge.claim_component_links link
      JOIN knowledge.components node ON node.id = link.component_id AND node.is_active = true
      WHERE link.evidence_claim_id = component_claim.id AND link.review_status != 'rejected'
      ORDER BY (link.review_status = 'accepted') DESC, link.confidence DESC, node.depth DESC
      LIMIT 1
    ) component_tax ON true
    WHERE auth.role() IN ('authenticated', 'service_role')
      AND (
        p_component_slug IS NULL
        OR EXISTS (
          SELECT 1
          FROM component_target
          WHERE component_tax.path = component_target.path
             OR component_tax.path LIKE component_target.path || '/%'
        )
      )
    ORDER BY has_fm.id, (failure_link.review_status = 'accepted') DESC, failure_link.confidence DESC, failure_node.depth DESC
  ),
  base AS (
    SELECT
      matched.failure_mode_claim_id,
      matched.failure_mode_taxonomy_id,
      matched.failure_mode,
      matched.failure_mode_slug,
      matched.component_taxonomy_id,
      matched.component,
      matched.component_slug,
      cause_values.value AS cause,
      effect_values.value AS effect,
      control_values.value AS control,
      domain_values.value AS domain,
      matched.confidence,
      matched.review_status,
      paper.doi,
      paper.title,
      paper.journal,
      paper.publication_year,
      paper.source
    FROM matched
    JOIN papers_raw.paper_candidates paper
      ON paper.id = matched.paper_candidate_id
      AND paper.lifecycle_status <> 'removed'
    LEFT JOIN LATERAL (
      SELECT STRING_AGG(DISTINCT COALESCE(claim.normalized_value, claim.raw_value), '; ' ORDER BY COALESCE(claim.normalized_value, claim.raw_value)) AS value
      FROM knowledge.claim_relationships relationship
      JOIN knowledge.evidence_claims claim ON claim.id = relationship.object_claim_id AND claim.claim_type = 'cause' AND claim.review_status NOT IN ('rejected', 'superseded')
      WHERE relationship.subject_claim_id = matched.failure_mode_claim_id AND relationship.relationship_type = 'caused_by'
        AND relationship.review_status NOT IN ('rejected', 'superseded') AND relationship.classification_job_id = matched.classification_job_id
    ) cause_values ON true
    LEFT JOIN LATERAL (
      SELECT STRING_AGG(DISTINCT COALESCE(claim.normalized_value, claim.raw_value), '; ' ORDER BY COALESCE(claim.normalized_value, claim.raw_value)) AS value
      FROM knowledge.claim_relationships relationship
      JOIN knowledge.evidence_claims claim ON claim.id = relationship.object_claim_id AND claim.claim_type = 'effect' AND claim.review_status NOT IN ('rejected', 'superseded')
      WHERE relationship.subject_claim_id = matched.failure_mode_claim_id AND relationship.relationship_type = 'has_effect'
        AND relationship.review_status NOT IN ('rejected', 'superseded') AND relationship.classification_job_id = matched.classification_job_id
    ) effect_values ON true
    LEFT JOIN LATERAL (
      SELECT STRING_AGG(DISTINCT COALESCE(claim.normalized_value, claim.raw_value), '; ' ORDER BY COALESCE(claim.normalized_value, claim.raw_value)) AS value
      FROM knowledge.claim_relationships relationship
      JOIN knowledge.evidence_claims claim ON claim.id = relationship.object_claim_id AND claim.claim_type = 'control' AND claim.review_status NOT IN ('rejected', 'superseded')
      WHERE relationship.subject_claim_id = matched.failure_mode_claim_id AND relationship.relationship_type = 'mitigated_by'
        AND relationship.review_status NOT IN ('rejected', 'superseded') AND relationship.classification_job_id = matched.classification_job_id
    ) control_values ON true
    LEFT JOIN LATERAL (
      SELECT STRING_AGG(DISTINCT COALESCE(claim.normalized_value, claim.raw_value), '; ' ORDER BY COALESCE(claim.normalized_value, claim.raw_value)) AS value
      FROM knowledge.evidence_claims claim
      WHERE claim.paper_candidate_id = matched.paper_candidate_id AND claim.classification_job_id = matched.classification_job_id
        AND claim.claim_type = 'application' AND claim.review_status NOT IN ('rejected', 'superseded')
    ) domain_values ON true
    WHERE p_domain IS NULL OR domain_values.value ILIKE '%' || p_domain || '%'
  )
  SELECT base.*, COUNT(*) OVER () AS total_count
  FROM base
  ORDER BY confidence DESC NULLS LAST, publication_year DESC NULLS LAST, failure_mode_claim_id
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 100), 1), 500)
  OFFSET GREATEST(COALESCE(p_offset, 0), 0);
$$;

CREATE OR REPLACE FUNCTION public.get_failure_mode_taxonomy(
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
      FROM knowledge.failure_modes child
      WHERE child.parent_id = node.id AND child.is_active = true
    ) AS child_count,
    (
      SELECT COUNT(*)
      FROM knowledge.claim_failure_mode_links link
      JOIN knowledge.failure_modes subtree
        ON subtree.id = link.failure_mode_id
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
  FROM knowledge.failure_modes node
  WHERE auth.role() IN ('authenticated', 'service_role')
    AND node.is_active = true
    AND (
      (p_parent_slug IS NULL AND node.parent_id IS NULL)
      OR node.parent_id = (
        SELECT parent.id
        FROM knowledge.failure_modes parent
        WHERE parent.slug = p_parent_slug AND parent.is_active = true
      )
    )
  ORDER BY linked_claim_count DESC, node.name;
$$;

REVOKE ALL ON FUNCTION public.resolve_fmea_taxonomy_node(text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.search_fmea_evidence(text, integer, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.search_fmea_by_component(text, text, integer, integer, numeric) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.search_fmea_by_failure_mode(text, text, text, integer, integer, numeric) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_failure_mode_taxonomy(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_fmea_taxonomy_node(text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.search_fmea_evidence(text, integer, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.search_fmea_by_component(text, text, integer, integer, numeric) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.search_fmea_by_failure_mode(text, text, text, integer, integer, numeric) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_failure_mode_taxonomy(text) TO authenticated, service_role;
