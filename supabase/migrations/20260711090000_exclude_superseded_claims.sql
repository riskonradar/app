-- Re-classification now supersedes old unreviewed claims (review_status =
-- 'superseded') instead of deleting them. Serving functions must exclude
-- superseded claims or re-runs would double-display every claim.
-- Redefines: get_knowledge_components, search_fmea_evidence, get_turbofan_fmea.

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
    AND comp.review_status <> 'superseded'
  -- failure_mode → caused_by → cause (optional)
  LEFT JOIN knowledge.claim_relationships caused_by_rel
    ON  caused_by_rel.subject_claim_id  = fm.id
    AND caused_by_rel.relationship_type = 'caused_by'
  LEFT JOIN knowledge.evidence_claims cause_c
    ON  cause_c.id = caused_by_rel.object_claim_id
    AND cause_c.review_status <> 'superseded'
  -- failure_mode → has_effect → effect (optional)
  LEFT JOIN knowledge.claim_relationships has_eff_rel
    ON  has_eff_rel.subject_claim_id  = fm.id
    AND has_eff_rel.relationship_type = 'has_effect'
  LEFT JOIN knowledge.evidence_claims eff_c
    ON  eff_c.id = has_eff_rel.object_claim_id
    AND eff_c.review_status <> 'superseded'
  -- failure_mode → mitigated_by → control (optional)
  LEFT JOIN knowledge.claim_relationships mitigated_by_rel
    ON  mitigated_by_rel.subject_claim_id  = fm.id
    AND mitigated_by_rel.relationship_type = 'mitigated_by'
  LEFT JOIN knowledge.evidence_claims ctrl_c
    ON  ctrl_c.id = mitigated_by_rel.object_claim_id
    AND ctrl_c.review_status <> 'superseded'
  -- source paper
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
      AND comp.review_status NOT IN ('rejected', 'superseded')
    JOIN knowledge.evidence_claims fm
      ON fm.id = has_fm.object_claim_id
      AND fm.claim_type = 'failure_mode'
      AND fm.review_status NOT IN ('rejected', 'superseded')
    WHERE has_fm.relationship_type = 'has_failure_mode'
      AND has_fm.review_status NOT IN ('rejected', 'superseded')
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
      AND eff_rel.review_status NOT IN ('rejected', 'superseded')
    LEFT JOIN knowledge.evidence_claims eff
      ON eff.id = eff_rel.object_claim_id
      AND eff.review_status NOT IN ('rejected', 'superseded')
    LEFT JOIN knowledge.claim_relationships cause_rel
      ON cause_rel.subject_claim_id = b.failure_mode_claim_id
      AND cause_rel.relationship_type = 'caused_by'
      AND cause_rel.review_status NOT IN ('rejected', 'superseded')
    LEFT JOIN knowledge.evidence_claims cause
      ON cause.id = cause_rel.object_claim_id
      AND cause.review_status NOT IN ('rejected', 'superseded')
    LEFT JOIN knowledge.claim_relationships detect_rel
      ON detect_rel.subject_claim_id = b.failure_mode_claim_id
      AND detect_rel.relationship_type = 'detected_by'
      AND detect_rel.review_status NOT IN ('rejected', 'superseded')
    LEFT JOIN knowledge.evidence_claims detect
      ON detect.id = detect_rel.object_claim_id
      AND detect.review_status NOT IN ('rejected', 'superseded')
    LEFT JOIN knowledge.claim_relationships action_rel
      ON action_rel.subject_claim_id = b.failure_mode_claim_id
      AND action_rel.relationship_type = 'corrected_by'
      AND action_rel.review_status NOT IN ('rejected', 'superseded')
    LEFT JOIN knowledge.evidence_claims action
      ON action.id = action_rel.object_claim_id
      AND action.review_status NOT IN ('rejected', 'superseded')
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
