-- Security hardening for the authenticated product database.
-- The public marketing site is separate; product knowledge and review state
-- should not be dumpable or mutable through anon Supabase access.

-- ============================================================
-- Role and table privilege posture
-- ============================================================

REVOKE ALL ON SCHEMA app FROM PUBLIC, anon;
REVOKE ALL ON ALL TABLES IN SCHEMA app FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA app FROM anon;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA app FROM anon;

GRANT USAGE ON SCHEMA app TO authenticated, service_role;
GRANT SELECT ON
  app.user_accounts,
  app.organizations,
  app.organization_memberships,
  app.workspace_invitations,
  app.subscription_plans,
  app.billing_subscriptions,
  app.billing_customers,
  app.billing_payments,
  app.assets,
  app.fmea_analyses,
  app.fmea_rows,
  app.fmea_row_evidence,
  app.fmea_review_events,
  app.evidence_claim_reviews,
  app.account_audit_events
TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA app FROM authenticated;

REVOKE ALL ON SCHEMA knowledge FROM PUBLIC, anon;
REVOKE ALL ON ALL TABLES IN SCHEMA knowledge FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA knowledge FROM anon;
GRANT USAGE ON SCHEMA knowledge TO authenticated, service_role;
GRANT SELECT ON
  knowledge.classification_jobs,
  knowledge.evidence_claims,
  knowledge.evidence_spans,
  knowledge.claim_relationships,
  knowledge.components,
  knowledge.claim_component_links
TO authenticated;

REVOKE ALL ON SCHEMA papers_raw FROM PUBLIC, anon;
REVOKE ALL ON ALL TABLES IN SCHEMA papers_raw FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA papers_raw FROM anon;
GRANT USAGE ON SCHEMA papers_raw TO authenticated, service_role;
GRANT SELECT ON
  papers_raw.discovery_runs,
  papers_raw.paper_candidates
TO authenticated;

REVOKE ALL ON public.easa_ads FROM PUBLIC, anon;
GRANT SELECT ON public.easa_ads TO authenticated;

-- ============================================================
-- Replace permissive policies with role-scoped policies
-- ============================================================

DROP POLICY IF EXISTS "service role all user_accounts" ON app.user_accounts;
CREATE POLICY "service role all user_accounts"
  ON app.user_accounts FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "service role all billing_customers" ON app.billing_customers;
CREATE POLICY "service role all billing_customers"
  ON app.billing_customers FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "service role all billing_payments" ON app.billing_payments;
CREATE POLICY "service role all billing_payments"
  ON app.billing_payments FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "service role read discovery_runs" ON papers_raw.discovery_runs;
DROP POLICY IF EXISTS "authenticated read discovery_runs" ON papers_raw.discovery_runs;
CREATE POLICY "authenticated read discovery_runs"
  ON papers_raw.discovery_runs FOR SELECT
  USING (auth.role() IN ('authenticated', 'service_role'));

DROP POLICY IF EXISTS "service role read paper_candidates" ON papers_raw.paper_candidates;
DROP POLICY IF EXISTS "authenticated read paper_candidates" ON papers_raw.paper_candidates;
CREATE POLICY "authenticated read paper_candidates"
  ON papers_raw.paper_candidates FOR SELECT
  USING (auth.role() IN ('authenticated', 'service_role'));

DROP POLICY IF EXISTS "open read evidence_claims" ON knowledge.evidence_claims;
DROP POLICY IF EXISTS "authenticated read evidence_claims" ON knowledge.evidence_claims;
CREATE POLICY "authenticated read evidence_claims"
  ON knowledge.evidence_claims FOR SELECT
  USING (auth.role() IN ('authenticated', 'service_role'));

DROP POLICY IF EXISTS "service role update evidence_claims" ON knowledge.evidence_claims;
DROP POLICY IF EXISTS "service role all evidence_claims" ON knowledge.evidence_claims;
CREATE POLICY "service role all evidence_claims"
  ON knowledge.evidence_claims FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "open read evidence_spans" ON knowledge.evidence_spans;
DROP POLICY IF EXISTS "authenticated read evidence_spans" ON knowledge.evidence_spans;
CREATE POLICY "authenticated read evidence_spans"
  ON knowledge.evidence_spans FOR SELECT
  USING (auth.role() IN ('authenticated', 'service_role'));

DROP POLICY IF EXISTS "open read claim_relationships" ON knowledge.claim_relationships;
DROP POLICY IF EXISTS "authenticated read claim_relationships" ON knowledge.claim_relationships;
CREATE POLICY "authenticated read claim_relationships"
  ON knowledge.claim_relationships FOR SELECT
  USING (auth.role() IN ('authenticated', 'service_role'));

DROP POLICY IF EXISTS "open read classification_jobs" ON knowledge.classification_jobs;
DROP POLICY IF EXISTS "authenticated read classification_jobs" ON knowledge.classification_jobs;
CREATE POLICY "authenticated read classification_jobs"
  ON knowledge.classification_jobs FOR SELECT
  USING (auth.role() IN ('authenticated', 'service_role'));

DROP POLICY IF EXISTS "open read paper_classifications" ON knowledge.paper_classifications;
DROP POLICY IF EXISTS "authenticated read paper_classifications" ON knowledge.paper_classifications;

DROP POLICY IF EXISTS "open read components" ON knowledge.components;
DROP POLICY IF EXISTS "authenticated read components" ON knowledge.components;
CREATE POLICY "authenticated read components"
  ON knowledge.components FOR SELECT
  USING (auth.role() IN ('authenticated', 'service_role'));

DROP POLICY IF EXISTS "open read claim_component_links" ON knowledge.claim_component_links;
DROP POLICY IF EXISTS "authenticated read claim_component_links" ON knowledge.claim_component_links;
CREATE POLICY "authenticated read claim_component_links"
  ON knowledge.claim_component_links FOR SELECT
  USING (auth.role() IN ('authenticated', 'service_role'));

DROP POLICY IF EXISTS "open read easa_ads" ON public.easa_ads;
DROP POLICY IF EXISTS "authenticated read easa_ads" ON public.easa_ads;
CREATE POLICY "authenticated read easa_ads"
  ON public.easa_ads FOR SELECT
  USING (auth.role() IN ('authenticated', 'service_role'));

-- Obsolete global mutation RPC. Reviews are org-scoped in app.evidence_claim_reviews.
DROP FUNCTION IF EXISTS public.update_evidence_review_status(uuid, text);

-- ============================================================
-- Harden SECURITY DEFINER functions and enforce active classifier version
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_knowledge_components(
  p_limit int DEFAULT 100
)
RETURNS TABLE (
  component        text,
  failure_mode_count bigint,
  paper_count      bigint
)
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT
    c.name                                      AS component,
    count(DISTINCT fm.id)                      AS failure_mode_count,
    count(DISTINCT fm.paper_candidate_id)      AS paper_count
  FROM knowledge.components c
  JOIN knowledge.claim_component_links ccl
    ON ccl.component_id = c.id
    AND ccl.review_status != 'rejected'
  JOIN knowledge.evidence_claims comp
    ON comp.id = ccl.evidence_claim_id
    AND comp.claim_type = 'component'
    AND comp.review_status != 'rejected'
  JOIN knowledge.classification_jobs cj
    ON cj.id = comp.classification_job_id
    AND cj.status = 'completed'
    AND cj.classifier_version = 'llm-extractor-v2:gemini:gemini-flash-latest'
  JOIN knowledge.claim_relationships has_fm
    ON has_fm.subject_claim_id = comp.id
    AND has_fm.relationship_type = 'has_failure_mode'
    AND has_fm.review_status != 'rejected'
    AND has_fm.classification_job_id = comp.classification_job_id
  JOIN knowledge.evidence_claims fm
    ON fm.id = has_fm.object_claim_id
    AND fm.claim_type = 'failure_mode'
    AND fm.review_status != 'rejected'
  WHERE auth.role() IN ('authenticated', 'service_role')
    AND c.is_active = true
  GROUP BY c.name
  ORDER BY failure_mode_count DESC, paper_count DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 100), 0), 500);
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
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = pg_catalog
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
  JOIN knowledge.classification_jobs cj
    ON cj.id = fm.classification_job_id
    AND cj.status = 'completed'
    AND cj.classifier_version = 'llm-extractor-v2:gemini:gemini-flash-latest'
  JOIN knowledge.claim_relationships has_fm
    ON has_fm.object_claim_id = fm.id
    AND has_fm.relationship_type = 'has_failure_mode'
    AND has_fm.review_status != 'rejected'
    AND has_fm.classification_job_id = fm.classification_job_id
  JOIN knowledge.evidence_claims comp
    ON comp.id = has_fm.subject_claim_id
    AND comp.claim_type = 'component'
    AND comp.review_status != 'rejected'
  LEFT JOIN knowledge.claim_relationships caused_by_rel
    ON caused_by_rel.subject_claim_id = fm.id
    AND caused_by_rel.relationship_type = 'caused_by'
    AND caused_by_rel.review_status != 'rejected'
  LEFT JOIN knowledge.evidence_claims cause_c
    ON cause_c.id = caused_by_rel.object_claim_id
    AND cause_c.review_status != 'rejected'
  LEFT JOIN knowledge.claim_relationships has_eff_rel
    ON has_eff_rel.subject_claim_id = fm.id
    AND has_eff_rel.relationship_type = 'has_effect'
    AND has_eff_rel.review_status != 'rejected'
  LEFT JOIN knowledge.evidence_claims eff_c
    ON eff_c.id = has_eff_rel.object_claim_id
    AND eff_c.review_status != 'rejected'
  LEFT JOIN knowledge.claim_relationships mitigated_by_rel
    ON mitigated_by_rel.subject_claim_id = fm.id
    AND mitigated_by_rel.relationship_type = 'mitigated_by'
    AND mitigated_by_rel.review_status != 'rejected'
  LEFT JOIN knowledge.evidence_claims ctrl_c
    ON ctrl_c.id = mitigated_by_rel.object_claim_id
    AND ctrl_c.review_status != 'rejected'
  JOIN papers_raw.paper_candidates pc
    ON pc.id = fm.paper_candidate_id
  WHERE auth.role() IN ('authenticated', 'service_role')
    AND fm.claim_type = 'failure_mode'
    AND fm.review_status != 'rejected'
    AND (
      p_query IS NULL
      OR comp.normalized_value ILIKE '%' || p_query || '%'
      OR fm.normalized_value   ILIKE '%' || p_query || '%'
    )
  ORDER BY fm.confidence DESC NULLS LAST
  LIMIT  LEAST(GREATEST(COALESCE(p_limit, 100), 0), 500)
  OFFSET GREATEST(COALESCE(p_offset, 0), 0);
$$;

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
    AND cj.classifier_version = 'llm-extractor-v2:gemini:gemini-flash-latest'
  WHERE auth.role() IN ('authenticated', 'service_role')
    AND es.evidence_claim_id = p_claim_id
  ORDER BY es.char_start NULLS LAST;
$$;

CREATE OR REPLACE FUNCTION knowledge.link_component_claims(
  p_dry_run boolean DEFAULT false
)
RETURNS TABLE (claim_id uuid, normalized_value text, matched_slug text, match_method text, match_score numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_threshold numeric := 0.45;
BEGIN
  IF auth.role() != 'service_role' THEN
    RAISE EXCEPTION 'link_component_claims requires service_role';
  END IF;

  RETURN QUERY
  WITH unlinked AS (
    SELECT ec.id, ec.normalized_value
    FROM knowledge.evidence_claims ec
    JOIN knowledge.classification_jobs cj
      ON cj.id = ec.classification_job_id
      AND cj.status = 'completed'
      AND cj.classifier_version = 'llm-extractor-v2:gemini:gemini-flash-latest'
    WHERE ec.claim_type = 'component'
      AND ec.normalized_value IS NOT NULL
      AND ec.review_status != 'rejected'
      AND NOT EXISTS (
        SELECT 1 FROM knowledge.claim_component_links ccl
        WHERE ccl.evidence_claim_id = ec.id AND ccl.review_status != 'rejected'
      )
  ),
  exact_matches AS (
    SELECT u.id AS claim_id, u.normalized_value, c.slug, 'auto_exact'::text AS method, 1.0::numeric AS score, c.id AS comp_id
    FROM unlinked u
    JOIN knowledge.components c ON c.is_active = true
      AND (
        lower(c.name) = lower(u.normalized_value)
        OR lower(u.normalized_value) = ANY(SELECT lower(a) FROM unnest(c.aliases) a)
      )
  ),
  fuzzy_matches AS (
    SELECT DISTINCT ON (u.id)
      u.id AS claim_id, u.normalized_value, c.slug, 'auto_fuzzy'::text AS method,
      extensions.similarity(lower(u.normalized_value), lower(c.name)) AS score, c.id AS comp_id
    FROM unlinked u
    JOIN knowledge.components c ON c.is_active = true AND c.is_leaf = true
      AND extensions.similarity(lower(u.normalized_value), lower(c.name)) >= v_threshold
    WHERE u.id NOT IN (SELECT claim_id FROM exact_matches)
    ORDER BY u.id, extensions.similarity(lower(u.normalized_value), lower(c.name)) DESC
  ),
  all_matches AS (
    SELECT * FROM exact_matches UNION ALL SELECT * FROM fuzzy_matches
  )
  SELECT am.claim_id, am.normalized_value, am.slug, am.method, am.score
  FROM all_matches am;

  IF NOT p_dry_run THEN
    INSERT INTO knowledge.claim_component_links
      (evidence_claim_id, component_id, link_method, match_score, confidence, review_status)
    WITH unlinked AS (
      SELECT ec.id, ec.normalized_value
      FROM knowledge.evidence_claims ec
      JOIN knowledge.classification_jobs cj
        ON cj.id = ec.classification_job_id
        AND cj.status = 'completed'
        AND cj.classifier_version = 'llm-extractor-v2:gemini:gemini-flash-latest'
      WHERE ec.claim_type = 'component'
        AND ec.normalized_value IS NOT NULL
        AND ec.review_status != 'rejected'
        AND NOT EXISTS (
          SELECT 1 FROM knowledge.claim_component_links ccl
          WHERE ccl.evidence_claim_id = ec.id AND ccl.review_status != 'rejected'
        )
    ),
    exact_matches AS (
      SELECT u.id AS claim_id, c.id AS comp_id, 'auto_exact'::text AS method, 1.0::numeric AS score
      FROM unlinked u
      JOIN knowledge.components c ON c.is_active = true
        AND (
          lower(c.name) = lower(u.normalized_value)
          OR lower(u.normalized_value) = ANY(SELECT lower(a) FROM unnest(c.aliases) a)
        )
    ),
    fuzzy_matches AS (
      SELECT DISTINCT ON (u.id)
        u.id AS claim_id,
        c.id AS comp_id,
        'auto_fuzzy'::text AS method,
        extensions.similarity(lower(u.normalized_value), lower(c.name)) AS score
      FROM unlinked u
      JOIN knowledge.components c ON c.is_active = true AND c.is_leaf = true
        AND extensions.similarity(lower(u.normalized_value), lower(c.name)) >= v_threshold
      WHERE u.id NOT IN (SELECT claim_id FROM exact_matches)
      ORDER BY u.id, extensions.similarity(lower(u.normalized_value), lower(c.name)) DESC
    ),
    all_matches AS (
      SELECT * FROM exact_matches UNION ALL SELECT * FROM fuzzy_matches
    )
    SELECT
      am.claim_id,
      am.comp_id,
      am.method,
      am.score,
      CASE WHEN am.method = 'auto_exact' THEN 0.90 ELSE am.score * 0.70 END,
      'needs_review'
    FROM all_matches am
    ON CONFLICT (evidence_claim_id, component_id) DO UPDATE
      SET match_score = EXCLUDED.match_score,
          confidence = EXCLUDED.confidence,
          updated_at = now();
  END IF;
END;
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
      AND cj.classifier_version = 'llm-extractor-v2:gemini:gemini-flash-latest'
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
        AND cj.classifier_version = 'llm-extractor-v2:gemini:gemini-flash-latest'
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

CREATE OR REPLACE FUNCTION public.get_turbofan_fmea(
  p_limit int DEFAULT 500
)
RETURNS TABLE (
  component text,
  failure_mode text,
  effect text,
  cause text,
  severity text,
  occurrence text,
  detection text,
  corrective_action text,
  rpn text,
  evidence_count bigint,
  sources jsonb,
  component_order int,
  source_record_count bigint,
  relevant_record_count bigint
)
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  WITH classified_turbofan_jobs AS (
    SELECT cj.id AS classification_job_id, pc.id AS paper_candidate_id
    FROM knowledge.classification_jobs cj
    JOIN papers_raw.paper_candidates pc ON pc.id = cj.paper_candidate_id
    WHERE auth.role() IN ('authenticated', 'service_role')
      AND cj.status = 'completed'
      AND cj.classifier_version = 'llm-extractor-v2:gemini:gemini-flash-latest'
      AND cj.classifier_metadata->>'extractor' = 'llm'
      AND lower(coalesce(pc.title, '') || ' ' || coalesce(pc.abstract, '') || ' ' || coalesce(pc.journal, '')) LIKE '%turbofan%'
  ),
  component_order(component, ord) AS (VALUES
    ('fan blade', 1), ('fan', 1), ('fan case', 2), ('nacelle', 3),
    ('low-pressure compressor', 4), ('high-pressure compressor', 5),
    ('compressor blade', 5), ('combustor', 6), ('fuel nozzle', 7),
    ('nozzle', 7), ('high-pressure turbine', 8), ('low-pressure turbine', 9),
    ('turbine blade', 8), ('shaft', 10), ('bearing', 11), ('seal', 12),
    ('oil system', 13), ('pump', 14), ('valve', 15), ('gearbox', 16),
    ('sensor', 17), ('exhaust', 18)
  ),
  base AS (
    SELECT
      comp.id AS component_claim_id,
      fm.id AS failure_mode_claim_id,
      comp.paper_candidate_id,
      comp.normalized_value AS component,
      fm.normalized_value AS failure_mode,
      greatest(comp.confidence, fm.confidence) AS confidence
    FROM knowledge.claim_relationships has_fm
    JOIN classified_turbofan_jobs ctj
      ON ctj.classification_job_id = has_fm.classification_job_id
    JOIN knowledge.evidence_claims comp
      ON comp.id = has_fm.subject_claim_id
      AND comp.claim_type = 'component'
      AND comp.review_status != 'rejected'
    JOIN knowledge.evidence_claims fm
      ON fm.id = has_fm.object_claim_id
      AND fm.claim_type = 'failure_mode'
      AND fm.review_status != 'rejected'
    WHERE has_fm.relationship_type = 'has_failure_mode'
      AND has_fm.review_status != 'rejected'
  ),
  enriched AS (
    SELECT
      b.component,
      b.failure_mode,
      b.paper_candidate_id,
      eff.normalized_value AS effect,
      cause.normalized_value AS cause,
      detect.normalized_value AS detection,
      action.normalized_value AS corrective_action
    FROM base b
    LEFT JOIN knowledge.claim_relationships eff_rel
      ON eff_rel.subject_claim_id = b.failure_mode_claim_id
      AND eff_rel.relationship_type = 'has_effect'
      AND eff_rel.review_status != 'rejected'
    LEFT JOIN knowledge.evidence_claims eff
      ON eff.id = eff_rel.object_claim_id
      AND eff.review_status != 'rejected'
    LEFT JOIN knowledge.claim_relationships cause_rel
      ON cause_rel.subject_claim_id = b.failure_mode_claim_id
      AND cause_rel.relationship_type = 'caused_by'
      AND cause_rel.review_status != 'rejected'
    LEFT JOIN knowledge.evidence_claims cause
      ON cause.id = cause_rel.object_claim_id
      AND cause.review_status != 'rejected'
    LEFT JOIN knowledge.claim_relationships detect_rel
      ON detect_rel.subject_claim_id = b.failure_mode_claim_id
      AND detect_rel.relationship_type = 'detected_by'
      AND detect_rel.review_status != 'rejected'
    LEFT JOIN knowledge.evidence_claims detect
      ON detect.id = detect_rel.object_claim_id
      AND detect.review_status != 'rejected'
    LEFT JOIN knowledge.claim_relationships action_rel
      ON action_rel.subject_claim_id = b.failure_mode_claim_id
      AND action_rel.relationship_type = 'corrected_by'
      AND action_rel.review_status != 'rejected'
    LEFT JOIN knowledge.evidence_claims action
      ON action.id = action_rel.object_claim_id
      AND action.review_status != 'rejected'
  ),
  sources AS (
    SELECT DISTINCT
      e.component,
      e.failure_mode,
      jsonb_build_object(
        'title', pc.title,
        'year', coalesce(pc.publication_year::text, ''),
        'doi', coalesce(pc.doi, ''),
        'url', coalesce(pc.source_url, ''),
        'category', CASE WHEN pc.source = 'easa_ad' THEN 'easa_ad' ELSE 'journal_paper' END
      ) AS source
    FROM enriched e
    JOIN papers_raw.paper_candidates pc ON pc.id = e.paper_candidate_id
  ),
  assembled AS (
    SELECT
      e.component,
      e.failure_mode,
      coalesce(string_agg(DISTINCT e.effect, '; ' ORDER BY e.effect) FILTER (WHERE e.effect IS NOT NULL), '') AS effect,
      coalesce(string_agg(DISTINCT e.cause, '; ' ORDER BY e.cause) FILTER (WHERE e.cause IS NOT NULL), '') AS cause,
      coalesce(string_agg(DISTINCT e.detection, '; ' ORDER BY e.detection) FILTER (WHERE e.detection IS NOT NULL), '') AS detection,
      coalesce(string_agg(DISTINCT e.corrective_action, '; ' ORDER BY e.corrective_action) FILTER (WHERE e.corrective_action IS NOT NULL), '') AS corrective_action,
      count(DISTINCT e.paper_candidate_id) AS evidence_count,
      coalesce(jsonb_agg(DISTINCT s.source), '[]'::jsonb) AS sources,
      coalesce(min(co.ord), 999) AS component_order
    FROM enriched e
    LEFT JOIN component_order co
      ON lower(e.component) = co.component
    LEFT JOIN sources s
      ON s.component = e.component
      AND s.failure_mode = e.failure_mode
    GROUP BY e.component, e.failure_mode
  )
  SELECT
    assembled.component,
    assembled.failure_mode,
    assembled.effect,
    assembled.cause,
    '' AS severity,
    '' AS occurrence,
    assembled.detection,
    assembled.corrective_action,
    '' AS rpn,
    assembled.evidence_count,
    assembled.sources,
    assembled.component_order,
    (SELECT count(DISTINCT paper_candidate_id) FROM classified_turbofan_jobs) AS source_record_count,
    (SELECT count(DISTINCT paper_candidate_id) FROM enriched) AS relevant_record_count
  FROM assembled
  ORDER BY assembled.component_order, assembled.evidence_count DESC, assembled.failure_mode
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 500), 0), 1000);
$$;

REVOKE EXECUTE ON FUNCTION public.get_knowledge_components(int) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.search_fmea_evidence(text, int, int) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_evidence_spans(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.search_fmea_by_component(text, text, int, int, numeric) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_component_taxonomy(text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_turbofan_fmea(int) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION knowledge.link_component_claims(boolean) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION app.current_user_account_id() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION app.current_organization_ids() FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.get_knowledge_components(int) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.search_fmea_evidence(text, int, int) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_evidence_spans(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.search_fmea_by_component(text, text, int, int, numeric) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_component_taxonomy(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_turbofan_fmea(int) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION knowledge.link_component_claims(boolean) TO service_role;
GRANT EXECUTE ON FUNCTION app.current_user_account_id() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION app.current_organization_ids() TO authenticated, service_role;
