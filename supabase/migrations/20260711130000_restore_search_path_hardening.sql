-- 20260710120000_security_and_taxonomy_hardening.sql hardened several SECURITY
-- DEFINER functions with SET search_path = pg_catalog (prevents search_path
-- hijacking of elevated-privilege functions) and a runtime service_role check
-- on knowledge.link_component_claims. 20260711090000 and 20260711120000
-- (same day, later) used CREATE OR REPLACE FUNCTION on several of the same
-- functions and silently dropped both protections. This migration restores
-- them, and extends the same protections to the new failure-mode functions.
--
-- Also: 20260710120000 pinned get_knowledge_components / search_fmea_evidence
-- to a hardcoded classifier_version ('llm-extractor-v2:gemini:gemini-flash-latest').
-- That string is already stale (classifier is now llm-extractor-v3) and will
-- go stale again on every future model swap. Replaced with the same
-- classifier_metadata->>'extractor' = 'llm' check get_turbofan_fmea already
-- uses — version-independent, same intent (exclude keyword-fallback output).

-- ============================================================
-- search_path hardening (attribute-only, no logic change)
-- ============================================================

ALTER FUNCTION public.get_knowledge_components(int) SET search_path = pg_catalog;
ALTER FUNCTION public.search_fmea_evidence(text, int, int) SET search_path = pg_catalog;
ALTER FUNCTION public.get_turbofan_fmea(int) SET search_path = pg_catalog;
ALTER FUNCTION public.get_taxonomy_inbox(text, int) SET search_path = pg_catalog;
ALTER FUNCTION knowledge.link_component_claims(boolean) SET search_path = pg_catalog;
ALTER FUNCTION knowledge.link_failure_mode_claims(boolean) SET search_path = pg_catalog;

-- ============================================================
-- restore service_role-only check on both linkers
-- (linking writes claim_component_links / claim_failure_mode_links;
-- same privilege level as the write RPCs, same guard)
-- ============================================================

CREATE OR REPLACE FUNCTION knowledge.link_component_claims(
  p_dry_run boolean DEFAULT false
)
RETURNS TABLE (claim_id uuid, normalized_value text, matched_slug text, match_method text, match_score numeric)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  v_threshold numeric := 0.45;
BEGIN
  IF auth.role() != 'service_role' THEN
    RAISE EXCEPTION 'link_component_claims requires service_role';
  END IF;

  DROP TABLE IF EXISTS _component_matches;
  CREATE TEMP TABLE _component_matches AS
  WITH unlinked AS (
    SELECT ec.id, ec.normalized_value AS label
    FROM knowledge.evidence_claims ec
    WHERE ec.claim_type = 'component'
      AND ec.normalized_value IS NOT NULL
      AND ec.review_status NOT IN ('rejected', 'superseded')
      AND NOT EXISTS (
        SELECT 1 FROM knowledge.claim_component_links ccl
        WHERE ccl.evidence_claim_id = ec.id AND ccl.review_status != 'rejected'
      )
  ),
  exact_matches AS (
    SELECT u.id AS claim_id, u.label, c.id AS node_id, c.slug,
           'auto_exact'::text AS method, 1.0::numeric AS score
    FROM unlinked u
    JOIN knowledge.components c ON c.is_active = true
      AND (
        lower(c.name) = lower(u.label)
        OR lower(u.label) = ANY(SELECT lower(a) FROM unnest(c.aliases) a)
      )
  ),
  fuzzy_matches AS (
    SELECT DISTINCT ON (u.id)
      u.id AS claim_id, u.label, c.id AS node_id, c.slug,
      'auto_fuzzy'::text AS method,
      extensions.similarity(lower(u.label), lower(c.name))::numeric AS score
    FROM unlinked u
    JOIN knowledge.components c ON c.is_active = true AND c.is_leaf = true
      AND extensions.similarity(lower(u.label), lower(c.name)) >= v_threshold
    WHERE u.id NOT IN (SELECT em.claim_id FROM exact_matches em)
    ORDER BY u.id, extensions.similarity(lower(u.label), lower(c.name)) DESC
  )
  SELECT * FROM exact_matches UNION ALL SELECT * FROM fuzzy_matches;

  IF NOT p_dry_run THEN
    INSERT INTO knowledge.claim_component_links
      (evidence_claim_id, component_id, link_method, match_score, confidence, review_status)
    SELECT m.claim_id, m.node_id, m.method, m.score,
           CASE WHEN m.method = 'auto_exact' THEN 0.90 ELSE m.score * 0.70 END,
           'needs_review'
    FROM _component_matches m
    ON CONFLICT (evidence_claim_id, component_id) DO UPDATE
      SET match_score = EXCLUDED.match_score, confidence = EXCLUDED.confidence, updated_at = now();
  END IF;

  RETURN QUERY SELECT m.claim_id, m.label, m.slug, m.method, m.score FROM _component_matches m;
  DROP TABLE _component_matches;
END;
$$;

CREATE OR REPLACE FUNCTION knowledge.link_failure_mode_claims(
  p_dry_run boolean DEFAULT false
)
RETURNS TABLE (claim_id uuid, normalized_value text, matched_slug text, match_method text, match_score numeric)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  v_threshold numeric := 0.45;
BEGIN
  IF auth.role() != 'service_role' THEN
    RAISE EXCEPTION 'link_failure_mode_claims requires service_role';
  END IF;

  DROP TABLE IF EXISTS _fm_matches;
  CREATE TEMP TABLE _fm_matches AS
  WITH unlinked AS (
    SELECT ec.id, ec.normalized_value AS label
    FROM knowledge.evidence_claims ec
    WHERE ec.claim_type = 'failure_mode'
      AND ec.normalized_value IS NOT NULL
      AND ec.review_status NOT IN ('rejected', 'superseded')
      AND NOT EXISTS (
        SELECT 1 FROM knowledge.claim_failure_mode_links l
        WHERE l.evidence_claim_id = ec.id AND l.review_status != 'rejected'
      )
  ),
  exact_matches AS (
    SELECT u.id AS claim_id, u.label, fm.id AS node_id, fm.slug,
           'auto_exact'::text AS method, 1.0::numeric AS score
    FROM unlinked u
    JOIN knowledge.failure_modes fm ON fm.is_active = true
      AND (
        lower(fm.name) = lower(u.label)
        OR lower(u.label) = ANY(SELECT lower(a) FROM unnest(fm.aliases) a)
      )
  ),
  fuzzy_matches AS (
    SELECT DISTINCT ON (u.id)
      u.id AS claim_id, u.label, fm.id AS node_id, fm.slug,
      'auto_fuzzy'::text AS method,
      extensions.similarity(lower(u.label), lower(fm.name))::numeric AS score
    FROM unlinked u
    JOIN knowledge.failure_modes fm ON fm.is_active = true
      AND extensions.similarity(lower(u.label), lower(fm.name)) >= v_threshold
    WHERE u.id NOT IN (SELECT em.claim_id FROM exact_matches em)
    ORDER BY u.id, extensions.similarity(lower(u.label), lower(fm.name)) DESC
  )
  SELECT * FROM exact_matches UNION ALL SELECT * FROM fuzzy_matches;

  IF NOT p_dry_run THEN
    INSERT INTO knowledge.claim_failure_mode_links
      (evidence_claim_id, failure_mode_id, link_method, match_score, confidence, review_status)
    SELECT m.claim_id, m.node_id, m.method, m.score,
           CASE WHEN m.method = 'auto_exact' THEN 0.90 ELSE m.score * 0.70 END,
           'needs_review'
    FROM _fm_matches m
    ON CONFLICT (evidence_claim_id, failure_mode_id) DO UPDATE
      SET match_score = EXCLUDED.match_score, confidence = EXCLUDED.confidence, updated_at = now();
  END IF;

  RETURN QUERY SELECT m.claim_id, m.label, m.slug, m.method, m.score FROM _fm_matches m;
  DROP TABLE _fm_matches;
END;
$$;

-- ============================================================
-- replace the stale hardcoded classifier_version pin with a
-- version-independent extractor check on the two read RPCs
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_knowledge_components(
  p_limit int DEFAULT 100
)
RETURNS TABLE (
  component        text,
  failure_mode_count bigint,
  paper_count      bigint
)
SECURITY DEFINER SET search_path = pg_catalog
LANGUAGE sql STABLE
AS $$
  SELECT
    comp.normalized_value                    AS component,
    count(DISTINCT fm.id)                    AS failure_mode_count,
    count(DISTINCT fm.paper_candidate_id)    AS paper_count
  FROM knowledge.evidence_claims comp
  JOIN knowledge.classification_jobs comp_cj
    ON comp_cj.id = comp.classification_job_id
    AND comp_cj.status = 'completed'
    AND comp_cj.classifier_metadata->>'extractor' = 'llm'
  JOIN knowledge.claim_relationships has_fm
    ON  has_fm.subject_claim_id  = comp.id
    AND has_fm.relationship_type = 'has_failure_mode'
  JOIN knowledge.evidence_claims fm
    ON  fm.id         = has_fm.object_claim_id
    AND fm.claim_type = 'failure_mode'
    AND fm.review_status <> 'superseded'
  WHERE comp.claim_type         = 'component'
    AND comp.normalized_value IS NOT NULL
    AND comp.review_status <> 'superseded'
  GROUP BY comp.normalized_value
  ORDER BY failure_mode_count DESC, paper_count DESC
  LIMIT p_limit;
$$;

CREATE OR REPLACE FUNCTION public.search_fmea_evidence(
  p_query  text DEFAULT NULL,
  p_limit  int  DEFAULT 100,
  p_offset int  DEFAULT 0
)
RETURNS TABLE (
  failure_mode_id  uuid,
  component        text,
  failure_mode     text,
  cause            text,
  effect           text,
  control          text,
  confidence       numeric,
  review_status    text,
  doi              text,
  title            text,
  journal          text,
  publication_year int
)
SECURITY DEFINER SET search_path = pg_catalog
LANGUAGE sql STABLE
AS $$
  SELECT
    fm.id                       AS failure_mode_id,
    comp.normalized_value       AS component,
    fm.normalized_value         AS failure_mode,
    cause_c.normalized_value    AS cause,
    eff_c.normalized_value      AS effect,
    ctrl_c.normalized_value     AS control,
    fm.confidence,
    fm.review_status,
    pc.doi,
    pc.title,
    pc.journal,
    pc.publication_year
  FROM knowledge.evidence_claims fm
  JOIN knowledge.classification_jobs fm_cj
    ON fm_cj.id = fm.classification_job_id
    AND fm_cj.status = 'completed'
    AND fm_cj.classifier_metadata->>'extractor' = 'llm'
  JOIN knowledge.claim_relationships has_fm
    ON  has_fm.object_claim_id   = fm.id
    AND has_fm.relationship_type = 'has_failure_mode'
  JOIN knowledge.evidence_claims comp
    ON  comp.id         = has_fm.subject_claim_id
    AND comp.claim_type = 'component'
    AND comp.review_status <> 'superseded'
  LEFT JOIN knowledge.claim_relationships caused_by_rel
    ON  caused_by_rel.subject_claim_id  = fm.id
    AND caused_by_rel.relationship_type = 'caused_by'
  LEFT JOIN knowledge.evidence_claims cause_c
    ON  cause_c.id = caused_by_rel.object_claim_id
    AND cause_c.review_status <> 'superseded'
  LEFT JOIN knowledge.claim_relationships has_eff_rel
    ON  has_eff_rel.subject_claim_id  = fm.id
    AND has_eff_rel.relationship_type = 'has_effect'
  LEFT JOIN knowledge.evidence_claims eff_c
    ON  eff_c.id = has_eff_rel.object_claim_id
    AND eff_c.review_status <> 'superseded'
  LEFT JOIN knowledge.claim_relationships mitigated_by_rel
    ON  mitigated_by_rel.subject_claim_id  = fm.id
    AND mitigated_by_rel.relationship_type = 'mitigated_by'
  LEFT JOIN knowledge.evidence_claims ctrl_c
    ON  ctrl_c.id = mitigated_by_rel.object_claim_id
    AND ctrl_c.review_status <> 'superseded'
  JOIN papers_raw.paper_candidates pc
    ON pc.id = fm.paper_candidate_id
  WHERE fm.claim_type = 'failure_mode'
    AND fm.review_status <> 'superseded'
    AND (
      p_query IS NULL
      OR comp.normalized_value ILIKE '%' || p_query || '%'
      OR fm.normalized_value   ILIKE '%' || p_query || '%'
    )
  ORDER BY fm.confidence DESC NULLS LAST
  LIMIT  p_limit
  OFFSET p_offset;
$$;

-- ============================================================
-- confirm grants weren't broadened by any of the above
-- (CREATE OR REPLACE / ALTER preserve existing ACLs when the
-- signature is unchanged, but state it explicitly rather than
-- relying on that implicit behavior)
-- ============================================================

REVOKE EXECUTE ON FUNCTION public.get_knowledge_components(int) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.search_fmea_evidence(text, int, int) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_turbofan_fmea(int) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_taxonomy_inbox(text, int) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION knowledge.link_component_claims(boolean) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION knowledge.link_failure_mode_claims(boolean) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.get_knowledge_components(int) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.search_fmea_evidence(text, int, int) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_turbofan_fmea(int) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_taxonomy_inbox(text, int) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION knowledge.link_component_claims(boolean) TO service_role;
GRANT EXECUTE ON FUNCTION knowledge.link_failure_mode_claims(boolean) TO service_role;
