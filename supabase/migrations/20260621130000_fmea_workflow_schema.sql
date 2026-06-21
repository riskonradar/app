-- FMEA workflow persistence and classified-evidence assembly.
-- Raw papers remain in papers_raw.*; FMEA rows preserve lineage to knowledge.* claims.

CREATE TABLE IF NOT EXISTS app.assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_account_id uuid REFERENCES app.user_accounts(id) ON DELETE SET NULL,
  name text NOT NULL,
  asset_type text NOT NULL DEFAULT 'turbofan_engine',
  operating_context jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS assets_user_account_id_idx
ON app.assets(user_account_id);

CREATE TRIGGER set_assets_updated_at
BEFORE UPDATE ON app.assets
FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

ALTER TABLE app.assets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service role all assets" ON app.assets;
CREATE POLICY "service role all assets"
  ON app.assets FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE TABLE IF NOT EXISTS app.fmea_analyses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_account_id uuid REFERENCES app.user_accounts(id) ON DELETE SET NULL,
  asset_id uuid REFERENCES app.assets(id) ON DELETE SET NULL,
  name text NOT NULL,
  analysis_method text NOT NULL DEFAULT 'aiag_vda'
    CHECK (analysis_method IN ('aiag_vda', 'custom')),
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'in_review', 'approved', 'archived')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS fmea_analyses_user_account_id_idx
ON app.fmea_analyses(user_account_id);

CREATE INDEX IF NOT EXISTS fmea_analyses_asset_id_idx
ON app.fmea_analyses(asset_id);

CREATE TRIGGER set_fmea_analyses_updated_at
BEFORE UPDATE ON app.fmea_analyses
FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

ALTER TABLE app.fmea_analyses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service role all fmea_analyses" ON app.fmea_analyses;
CREATE POLICY "service role all fmea_analyses"
  ON app.fmea_analyses FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE TABLE IF NOT EXISTS app.fmea_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_id uuid NOT NULL REFERENCES app.fmea_analyses(id) ON DELETE CASCADE,
  component text NOT NULL,
  function text,
  failure_mode text NOT NULL,
  effect text,
  severity smallint CHECK (severity BETWEEN 1 AND 10),
  cause text,
  occurrence smallint CHECK (occurrence BETWEEN 1 AND 10),
  controls text,
  detection text,
  detection_rating smallint CHECK (detection_rating BETWEEN 1 AND 10),
  action_priority text CHECK (action_priority IN ('H', 'M', 'L')),
  recommended_action text,
  responsible_owner text,
  target_completion_date date,
  review_status text NOT NULL DEFAULT 'needs_review'
    CHECK (review_status IN ('needs_review', 'accepted', 'edited', 'rejected', 'superseded')),
  confidence numeric(5,4) CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  model_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  reviewer_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS fmea_rows_analysis_id_idx
ON app.fmea_rows(analysis_id);

CREATE INDEX IF NOT EXISTS fmea_rows_component_failure_mode_idx
ON app.fmea_rows(component, failure_mode);

CREATE INDEX IF NOT EXISTS fmea_rows_review_status_idx
ON app.fmea_rows(review_status);

CREATE TRIGGER set_fmea_rows_updated_at
BEFORE UPDATE ON app.fmea_rows
FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

ALTER TABLE app.fmea_rows ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service role all fmea_rows" ON app.fmea_rows;
CREATE POLICY "service role all fmea_rows"
  ON app.fmea_rows FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE TABLE IF NOT EXISTS app.fmea_row_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fmea_row_id uuid NOT NULL REFERENCES app.fmea_rows(id) ON DELETE CASCADE,
  fmea_field text NOT NULL
    CHECK (fmea_field IN (
      'component',
      'function',
      'failure_mode',
      'effect',
      'severity',
      'cause',
      'occurrence',
      'controls',
      'detection',
      'action_priority',
      'recommended_action'
    )),
  evidence_claim_id uuid REFERENCES knowledge.evidence_claims(id) ON DELETE RESTRICT,
  claim_relationship_id uuid REFERENCES knowledge.claim_relationships(id) ON DELETE RESTRICT,
  evidence_span_id uuid REFERENCES knowledge.evidence_spans(id) ON DELETE RESTRICT,
  confidence numeric(5,4) CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  contribution_type text NOT NULL DEFAULT 'supporting_claim'
    CHECK (contribution_type IN ('supporting_claim', 'supporting_relationship', 'source_span', 'reviewer_added')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    evidence_claim_id IS NOT NULL
    OR claim_relationship_id IS NOT NULL
    OR evidence_span_id IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS fmea_row_evidence_row_idx
ON app.fmea_row_evidence(fmea_row_id);

CREATE INDEX IF NOT EXISTS fmea_row_evidence_claim_idx
ON app.fmea_row_evidence(evidence_claim_id);

CREATE INDEX IF NOT EXISTS fmea_row_evidence_relationship_idx
ON app.fmea_row_evidence(claim_relationship_id);

ALTER TABLE app.fmea_row_evidence ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service role all fmea_row_evidence" ON app.fmea_row_evidence;
CREATE POLICY "service role all fmea_row_evidence"
  ON app.fmea_row_evidence FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE TABLE IF NOT EXISTS app.fmea_review_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fmea_row_id uuid NOT NULL REFERENCES app.fmea_rows(id) ON DELETE CASCADE,
  user_account_id uuid REFERENCES app.user_accounts(id) ON DELETE SET NULL,
  action text NOT NULL
    CHECK (action IN ('created', 'accepted', 'edited', 'rejected', 'superseded', 'commented')),
  before_state jsonb,
  after_state jsonb,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS fmea_review_events_row_idx
ON app.fmea_review_events(fmea_row_id);

ALTER TABLE app.fmea_review_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service role all fmea_review_events" ON app.fmea_review_events;
CREATE POLICY "service role all fmea_review_events"
  ON app.fmea_review_events FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

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
SECURITY DEFINER
LANGUAGE sql STABLE
AS $$
  WITH classified_turbofan_jobs AS (
    SELECT cj.id AS classification_job_id, pc.id AS paper_candidate_id
    FROM knowledge.classification_jobs cj
    JOIN papers_raw.paper_candidates pc ON pc.id = cj.paper_candidate_id
    WHERE cj.status = 'completed'
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
  LIMIT p_limit;
$$;
