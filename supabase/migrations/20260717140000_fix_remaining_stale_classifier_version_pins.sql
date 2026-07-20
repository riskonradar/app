-- 20260710120000_security_and_taxonomy_hardening.sql pinned SIX functions to a
-- hardcoded classifier_version = 'llm-extractor-v2:gemini:gemini-flash-latest'.
-- 20260711130000_restore_search_path_hardening.sql fixed three of them
-- (get_knowledge_components, search_fmea_evidence, link_component_claims /
-- link_failure_mode_claims) but missed three siblings that carry the exact
-- same stale pin: get_evidence_spans, search_fmea_by_component, and
-- get_component_taxonomy. Found during a full-repo re-audit (2026-07-17).
--
-- Left unfixed, these three return empty results against any classifier run
-- under a different version string (we're on llm-extractor-v4 now) — notably
-- search_fmea_by_component, which is the only taxonomy-aware search path the
-- web app actually calls, and get_evidence_spans, which backs the evidence/
-- citation drawer entirely. Both are silently broken by this pin regardless
-- of deployment state.
--
-- Same fix as before: replace the hardcoded version string with the
-- version-independent check get_turbofan_fmea already used correctly
-- (classifier_metadata->>'extractor' = 'llm'). All other logic, the
-- search_path hardening, and the auth checks are preserved exactly.

CREATE OR REPLACE FUNCTION public.get_evidence_spans(
  p_claim_id uuid
)
RETURNS TABLE (
  id           uuid,
  source_field text,
  text         text,
  char_start   int,
  char_end     int,
  license_safe boolean
)
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT es.id, es.source_field, es.text, es.char_start, es.char_end, es.license_safe
  FROM knowledge.evidence_spans es
  JOIN knowledge.evidence_claims ec
    ON ec.id = es.evidence_claim_id
  JOIN knowledge.classification_jobs cj
    ON cj.id = ec.classification_job_id
    AND cj.status = 'completed'
    AND cj.classifier_metadata->>'extractor' = 'llm'
  WHERE auth.role() IN ('authenticated', 'service_role')
    AND es.evidence_claim_id = p_claim_id
    AND es.license_safe = true
  ORDER BY es.char_start NULLS LAST;
$$;

CREATE OR REPLACE FUNCTION public.search_fmea_by_component(
  p_component_slug   text,
  p_domain           text  DEFAULT null,
  p_limit            int   DEFAULT 100,
  p_offset           int   DEFAULT 0,
  p_min_confidence   numeric DEFAULT 0.0
)
RETURNS TABLE (
  failure_mode_id    uuid,
  component          text,
  component_slug     text,
  failure_mode       text,
  cause              text,
  effect             text,
  control            text,
  domain             text,
  confidence         numeric,
  doi                text,
  title              text,
  journal            text,
  publication_year   int,
  source             text
)
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  WITH target AS (
    SELECT path FROM knowledge.components WHERE slug = p_component_slug AND is_active = true
  ),
  matched_components AS (
    SELECT
      ec.id AS claim_id,
      ec.paper_candidate_id,
      ec.classification_job_id,
      c.name AS comp_name,
      c.slug AS comp_slug
    FROM knowledge.claim_component_links ccl
    JOIN knowledge.evidence_claims ec
      ON ec.id = ccl.evidence_claim_id
      AND ec.claim_type = 'component'
      AND ec.review_status != 'rejected'
    JOIN knowledge.classification_jobs cj
      ON cj.id = ec.classification_job_id
      AND cj.status = 'completed'
      AND cj.classifier_metadata->>'extractor' = 'llm'
    JOIN knowledge.components c ON c.id = ccl.component_id
    CROSS JOIN target t
    WHERE auth.role() IN ('authenticated', 'service_role')
      AND c.path LIKE t.path || '%'
      AND ccl.review_status != 'rejected'
      AND c.is_active = true
  ),
  domain_papers AS (
    SELECT
      pc.id AS paper_candidate_id,
      max(app_claim.normalized_value) AS domain
    FROM papers_raw.paper_candidates pc
    LEFT JOIN knowledge.evidence_claims app_claim
      ON app_claim.paper_candidate_id = pc.id
      AND app_claim.claim_type = 'application'
      AND app_claim.review_status != 'rejected'
    GROUP BY pc.id
    HAVING p_domain IS NULL OR max(app_claim.normalized_value) ILIKE '%' || p_domain || '%'
  )
  SELECT
    fm.id,
    mc.comp_name,
    mc.comp_slug,
    fm.normalized_value,
    cause_c.normalized_value,
    eff_c.normalized_value,
    ctrl_c.normalized_value,
    dp.domain,
    fm.confidence,
    pc.doi,
    pc.title,
    pc.journal,
    pc.publication_year,
    pc.source
  FROM matched_components mc
  JOIN knowledge.claim_relationships has_fm
    ON has_fm.subject_claim_id = mc.claim_id
    AND has_fm.relationship_type = 'has_failure_mode'
    AND has_fm.review_status != 'rejected'
    AND has_fm.classification_job_id = mc.classification_job_id
  JOIN knowledge.evidence_claims fm
    ON fm.id = has_fm.object_claim_id
    AND fm.claim_type = 'failure_mode'
    AND fm.review_status != 'rejected'
    AND fm.confidence >= COALESCE(p_min_confidence, 0.0)
  JOIN domain_papers dp ON dp.paper_candidate_id = mc.paper_candidate_id
  LEFT JOIN knowledge.claim_relationships r_cause
    ON r_cause.subject_claim_id = fm.id
    AND r_cause.relationship_type = 'caused_by'
    AND r_cause.review_status != 'rejected'
  LEFT JOIN knowledge.evidence_claims cause_c ON cause_c.id = r_cause.object_claim_id AND cause_c.review_status != 'rejected'
  LEFT JOIN knowledge.claim_relationships r_eff
    ON r_eff.subject_claim_id = fm.id
    AND r_eff.relationship_type = 'has_effect'
    AND r_eff.review_status != 'rejected'
  LEFT JOIN knowledge.evidence_claims eff_c ON eff_c.id = r_eff.object_claim_id AND eff_c.review_status != 'rejected'
  LEFT JOIN knowledge.claim_relationships r_ctrl
    ON r_ctrl.subject_claim_id = fm.id
    AND r_ctrl.relationship_type = 'mitigated_by'
    AND r_ctrl.review_status != 'rejected'
  LEFT JOIN knowledge.evidence_claims ctrl_c ON ctrl_c.id = r_ctrl.object_claim_id AND ctrl_c.review_status != 'rejected'
  JOIN papers_raw.paper_candidates pc ON pc.id = fm.paper_candidate_id
  ORDER BY fm.confidence DESC NULLS LAST
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 100), 0), 500)
  OFFSET GREATEST(COALESCE(p_offset, 0), 0);
$$;

CREATE OR REPLACE FUNCTION public.get_component_taxonomy(
  p_parent_slug text DEFAULT null
)
RETURNS TABLE (
  id                 uuid,
  name               text,
  slug               text,
  path               text,
  depth              smallint,
  is_leaf            boolean,
  description        text,
  child_count        bigint,
  linked_claim_count bigint
)
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT
    c.id,
    c.name,
    c.slug,
    c.path,
    c.depth,
    c.is_leaf,
    c.description,
    (SELECT count(*) FROM knowledge.components child WHERE child.parent_id = c.id AND child.is_active = true) AS child_count,
    (
      SELECT count(*)
      FROM knowledge.claim_component_links ccl
      JOIN knowledge.components subtree ON subtree.path LIKE c.path || '%'
      JOIN knowledge.evidence_claims ec ON ec.id = ccl.evidence_claim_id AND ec.review_status != 'rejected'
      JOIN knowledge.classification_jobs cj
        ON cj.id = ec.classification_job_id
        AND cj.status = 'completed'
        AND cj.classifier_metadata->>'extractor' = 'llm'
      WHERE ccl.component_id = subtree.id
        AND ccl.review_status != 'rejected'
    ) AS linked_claim_count
  FROM knowledge.components c
  WHERE auth.role() IN ('authenticated', 'service_role')
    AND c.is_active = true
    AND (
      (p_parent_slug IS NULL AND c.parent_id IS NULL)
      OR c.parent_id = (SELECT parent.id FROM knowledge.components parent WHERE parent.slug = p_parent_slug)
    )
  ORDER BY linked_claim_count DESC, c.name;
$$;

-- Also grant the same table-level SELECT the component-taxonomy tables got in
-- 20260710120000, extended to their failure-mode siblings, which never
-- received the equivalent grant (found in the same re-audit).
GRANT SELECT ON knowledge.failure_modes TO authenticated;
GRANT SELECT ON knowledge.claim_failure_mode_links TO authenticated;
