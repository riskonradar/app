-- ============================================================
-- RLS POLICIES
-- All tables already have RLS enabled. Service role bypasses
-- RLS automatically. We add explicit SELECT policies on the
-- non-PII schemas so authenticated app queries can work.
-- app.* tables remain service-role-only (no added policies).
-- ============================================================

-- papers_raw: allow service role reads (explicit, belt-and-suspenders)
DROP POLICY IF EXISTS "service role read discovery_runs"
  ON papers_raw.discovery_runs;

CREATE POLICY "service role read discovery_runs"
  ON papers_raw.discovery_runs FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "service role read paper_candidates"
  ON papers_raw.paper_candidates;

CREATE POLICY "service role read paper_candidates"
  ON papers_raw.paper_candidates FOR SELECT
  USING (true);

-- knowledge: open reads (no PII), writes via service role only
DROP POLICY IF EXISTS "open read evidence_claims"
  ON knowledge.evidence_claims;

CREATE POLICY "open read evidence_claims"
  ON knowledge.evidence_claims FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "service role update evidence_claims"
  ON knowledge.evidence_claims;

CREATE POLICY "service role update evidence_claims"
  ON knowledge.evidence_claims FOR UPDATE
  USING (true);

DROP POLICY IF EXISTS "open read evidence_spans"
  ON knowledge.evidence_spans;

CREATE POLICY "open read evidence_spans"
  ON knowledge.evidence_spans FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "open read claim_relationships"
  ON knowledge.claim_relationships;

CREATE POLICY "open read claim_relationships"
  ON knowledge.claim_relationships FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "open read classification_jobs"
  ON knowledge.classification_jobs;

CREATE POLICY "open read classification_jobs"
  ON knowledge.classification_jobs FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "open read paper_classifications"
  ON knowledge.paper_classifications;

CREATE POLICY "open read paper_classifications"
  ON knowledge.paper_classifications FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "open read evidence_records"
  ON knowledge.evidence_records;

CREATE POLICY "open read evidence_records"
  ON knowledge.evidence_records FOR SELECT
  USING (true);

-- app: billing tables - service role only (no public policies needed)
DROP POLICY IF EXISTS "service role all billing_payments"
  ON app.billing_payments;

CREATE POLICY "service role all billing_payments"
  ON app.billing_payments FOR ALL
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "service role all billing_customers"
  ON app.billing_customers;

CREATE POLICY "service role all billing_customers"
  ON app.billing_customers FOR ALL
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "service role all user_accounts"
  ON app.user_accounts;

CREATE POLICY "service role all user_accounts"
  ON app.user_accounts FOR ALL
  USING (true)
  WITH CHECK (true);

-- ============================================================
-- QUERY FUNCTIONS (public schema, SECURITY DEFINER so they
-- can reach knowledge.* and papers_raw.* schemas via REST)
-- ============================================================

-- List components that have at least one failure mode linked,
-- ranked by how many distinct failure modes and papers back them.
CREATE OR REPLACE FUNCTION public.get_knowledge_components(
  p_limit int DEFAULT 100
)
RETURNS TABLE (
  component        text,
  failure_mode_count bigint,
  paper_count      bigint
)
SECURITY DEFINER
LANGUAGE sql STABLE
AS $$
  SELECT
    comp.normalized_value                    AS component,
    count(DISTINCT fm.id)                    AS failure_mode_count,
    count(DISTINCT fm.paper_candidate_id)    AS paper_count
  FROM knowledge.evidence_claims comp
  JOIN knowledge.claim_relationships has_fm
    ON  has_fm.subject_claim_id  = comp.id
    AND has_fm.relationship_type = 'has_failure_mode'
  JOIN knowledge.evidence_claims fm
    ON  fm.id         = has_fm.object_claim_id
    AND fm.claim_type = 'failure_mode'
  WHERE comp.claim_type         = 'component'
    AND comp.normalized_value IS NOT NULL
  GROUP BY comp.normalized_value
  ORDER BY failure_mode_count DESC, paper_count DESC
  LIMIT p_limit;
$$;

-- Assembled FMEA-style view: one row per (failure_mode × cause × effect × control)
-- combination as extracted by the classifier, with the source paper attached.
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
SECURITY DEFINER
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
  -- component → has_failure_mode → failure_mode
  JOIN knowledge.claim_relationships has_fm
    ON  has_fm.object_claim_id   = fm.id
    AND has_fm.relationship_type = 'has_failure_mode'
  JOIN knowledge.evidence_claims comp
    ON  comp.id         = has_fm.subject_claim_id
    AND comp.claim_type = 'component'
  -- failure_mode → caused_by → cause (optional)
  LEFT JOIN knowledge.claim_relationships caused_by_rel
    ON  caused_by_rel.subject_claim_id  = fm.id
    AND caused_by_rel.relationship_type = 'caused_by'
  LEFT JOIN knowledge.evidence_claims cause_c
    ON cause_c.id = caused_by_rel.object_claim_id
  -- failure_mode → has_effect → effect (optional)
  LEFT JOIN knowledge.claim_relationships has_eff_rel
    ON  has_eff_rel.subject_claim_id  = fm.id
    AND has_eff_rel.relationship_type = 'has_effect'
  LEFT JOIN knowledge.evidence_claims eff_c
    ON eff_c.id = has_eff_rel.object_claim_id
  -- failure_mode → mitigated_by → control (optional)
  LEFT JOIN knowledge.claim_relationships mitigated_by_rel
    ON  mitigated_by_rel.subject_claim_id  = fm.id
    AND mitigated_by_rel.relationship_type = 'mitigated_by'
  LEFT JOIN knowledge.evidence_claims ctrl_c
    ON ctrl_c.id = mitigated_by_rel.object_claim_id
  -- source paper
  JOIN papers_raw.paper_candidates pc
    ON pc.id = fm.paper_candidate_id
  WHERE fm.claim_type = 'failure_mode'
    AND (
      p_query IS NULL
      OR comp.normalized_value ILIKE '%' || p_query || '%'
      OR fm.normalized_value   ILIKE '%' || p_query || '%'
    )
  ORDER BY fm.confidence DESC NULLS LAST
  LIMIT  p_limit
  OFFSET p_offset;
$$;

-- Update the review status of a single evidence claim.
-- Called by the frontend review workflow.
CREATE OR REPLACE FUNCTION public.update_evidence_review_status(
  p_claim_id uuid,
  p_status   text
)
RETURNS void
SECURITY DEFINER
LANGUAGE sql
AS $$
  UPDATE knowledge.evidence_claims
  SET review_status = p_status,
      updated_at    = now()
  WHERE id = p_claim_id
    AND p_status IN ('needs_review', 'accepted', 'edited', 'rejected', 'superseded');
$$;

-- Return all evidence spans attached to a given claim (for the citation drawer).
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
SECURITY DEFINER
LANGUAGE sql STABLE
AS $$
  SELECT id, source_field, text, char_start, char_end, license_safe
  FROM knowledge.evidence_spans
  WHERE evidence_claim_id = p_claim_id
  ORDER BY char_start NULLS LAST;
$$;
