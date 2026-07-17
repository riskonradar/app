-- Preserve stable worksheet rows so evidence lineage and review events survive saves,
-- then expose one service-role-only transaction for the complete worksheet write.

ALTER TABLE app.fmea_rows
ADD COLUMN IF NOT EXISTS client_row_id text;

UPDATE app.fmea_rows
SET client_row_id = COALESCE(NULLIF(model_metadata->>'clientRowId', ''), id::text)
WHERE client_row_id IS NULL;

ALTER TABLE app.fmea_rows
ALTER COLUMN client_row_id SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS fmea_rows_analysis_client_row_id_idx
ON app.fmea_rows(analysis_id, client_row_id);

-- Return every field-level claim and exact span behind a searched failure-mode claim.
-- This keeps non-public knowledge schemas behind an authenticated, read-only contract.
CREATE OR REPLACE FUNCTION public.get_fmea_evidence_lineage(
  p_failure_mode_claim_ids uuid[]
)
RETURNS TABLE (
  failure_mode_claim_id uuid,
  evidence jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  WITH requested_ids AS (
    SELECT DISTINCT unnest(COALESCE(p_failure_mode_claim_ids, ARRAY[]::uuid[])) AS failure_mode_claim_id
  ),
  requested AS (
    SELECT
      failure_claim.id AS failure_mode_claim_id,
      failure_claim.classification_job_id,
      failure_claim.paper_candidate_id
    FROM requested_ids requested_id
    JOIN knowledge.evidence_claims failure_claim
      ON failure_claim.id = requested_id.failure_mode_claim_id
      AND failure_claim.claim_type = 'failure_mode'
      AND failure_claim.review_status NOT IN ('rejected', 'superseded')
    JOIN knowledge.classification_jobs job
      ON job.id = failure_claim.classification_job_id
      AND job.status = 'completed'
      AND job.classifier_metadata->>'extractor' = 'llm'
    JOIN papers_raw.paper_candidates source_paper
      ON source_paper.id = failure_claim.paper_candidate_id
      AND source_paper.lifecycle_status <> 'removed'
  ),
  lineage_references AS (
    SELECT r.failure_mode_claim_id, r.failure_mode_claim_id AS claim_id, 'failure_mode'::text AS fmea_field,
           NULL::uuid AS relationship_id, r.classification_job_id, r.paper_candidate_id
    FROM requested r
    UNION ALL
    SELECT r.failure_mode_claim_id, rel.subject_claim_id, 'component', rel.id,
           r.classification_job_id, r.paper_candidate_id
    FROM requested r
    JOIN knowledge.claim_relationships rel
      ON rel.object_claim_id = r.failure_mode_claim_id
      AND rel.relationship_type = 'has_failure_mode'
      AND rel.review_status NOT IN ('rejected', 'superseded')
      AND rel.classification_job_id = r.classification_job_id
      AND rel.paper_candidate_id = r.paper_candidate_id
    UNION ALL
    SELECT
      r.failure_mode_claim_id,
      rel.object_claim_id,
      CASE rel.relationship_type
        WHEN 'caused_by' THEN 'cause'
        WHEN 'has_effect' THEN 'effect'
        WHEN 'mitigated_by' THEN 'controls'
        WHEN 'detected_by' THEN 'detection'
        WHEN 'corrected_by' THEN 'recommended_action'
      END,
      rel.id,
      r.classification_job_id,
      r.paper_candidate_id
    FROM requested r
    JOIN knowledge.claim_relationships rel
      ON rel.subject_claim_id = r.failure_mode_claim_id
      AND rel.relationship_type IN ('caused_by', 'has_effect', 'mitigated_by', 'detected_by', 'corrected_by')
      AND rel.review_status NOT IN ('rejected', 'superseded')
      AND rel.classification_job_id = r.classification_job_id
      AND rel.paper_candidate_id = r.paper_candidate_id
    UNION ALL
    SELECT r.failure_mode_claim_id, action_rel.object_claim_id, 'recommended_action', action_rel.id,
           r.classification_job_id, r.paper_candidate_id
    FROM requested r
    JOIN knowledge.claim_relationships has_fm
      ON has_fm.object_claim_id = r.failure_mode_claim_id
      AND has_fm.relationship_type = 'has_failure_mode'
      AND has_fm.review_status NOT IN ('rejected', 'superseded')
      AND has_fm.classification_job_id = r.classification_job_id
      AND has_fm.paper_candidate_id = r.paper_candidate_id
    JOIN knowledge.claim_relationships action_rel
      ON action_rel.subject_claim_id = has_fm.subject_claim_id
      AND action_rel.relationship_type = 'corrected_by'
      AND action_rel.review_status NOT IN ('rejected', 'superseded')
      AND action_rel.classification_job_id = r.classification_job_id
      AND action_rel.paper_candidate_id = r.paper_candidate_id
  ),
  assembled AS (
    SELECT
      ref.failure_mode_claim_id,
      jsonb_build_object(
        'field', ref.fmea_field,
        'claimId', claim.id,
        'claimType', claim.claim_type,
        'value', COALESCE(claim.normalized_value, claim.raw_value, ''),
        'confidence', claim.confidence,
        'supportType', claim.support_type,
        'reviewStatus', claim.review_status,
        'relationshipId', ref.relationship_id,
        'spans', COALESCE((
          SELECT jsonb_agg(
            jsonb_build_object(
              'id', span.id,
              'sourceField', span.source_field,
              'text', span.text,
              'charStart', span.char_start,
              'charEnd', span.char_end,
              'licenseSafe', span.license_safe
            ) ORDER BY span.char_start NULLS LAST
          )
          FROM knowledge.evidence_spans span
          WHERE span.evidence_claim_id = claim.id
            AND span.license_safe = true
        ), '[]'::jsonb),
        'source', jsonb_build_object(
          'title', paper.title,
          'year', paper.publication_year::text,
          'doi', paper.doi,
          'url', COALESCE(paper.source_url, CASE WHEN paper.doi IS NOT NULL THEN 'https://doi.org/' || paper.doi END),
          'category', COALESCE(paper.source, paper.journal)
        )
      ) AS reference
    FROM lineage_references ref
    JOIN knowledge.evidence_claims claim
      ON claim.id = ref.claim_id
      AND claim.review_status NOT IN ('rejected', 'superseded')
      AND claim.classification_job_id = ref.classification_job_id
      AND claim.paper_candidate_id = ref.paper_candidate_id
      AND claim.claim_type = CASE ref.fmea_field
        WHEN 'component' THEN 'component'
        WHEN 'failure_mode' THEN 'failure_mode'
        WHEN 'effect' THEN 'effect'
        WHEN 'cause' THEN 'cause'
        WHEN 'controls' THEN 'control'
        WHEN 'detection' THEN 'detection_method'
        WHEN 'recommended_action' THEN 'corrective_action'
      END
    JOIN papers_raw.paper_candidates paper
      ON paper.id = claim.paper_candidate_id
      AND paper.lifecycle_status <> 'removed'
    WHERE auth.role() IN ('authenticated', 'service_role')
      AND ref.fmea_field IS NOT NULL
  )
  SELECT
    r.failure_mode_claim_id,
    COALESCE(jsonb_agg(a.reference) FILTER (WHERE a.reference IS NOT NULL), '[]'::jsonb) AS evidence
  FROM requested r
  LEFT JOIN assembled a ON a.failure_mode_claim_id = r.failure_mode_claim_id
  GROUP BY r.failure_mode_claim_id;
$$;

REVOKE ALL ON FUNCTION public.get_fmea_evidence_lineage(uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_fmea_evidence_lineage(uuid[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_fmea_evidence_lineage(uuid[]) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.save_fmea_analysis_transaction(
  p_analysis_id uuid,
  p_organization_id uuid,
  p_user_account_id uuid,
  p_name text,
  p_rows jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_analysis_id uuid := p_analysis_id;
  v_row jsonb;
  v_evidence jsonb;
  v_span jsonb;
  v_row_id uuid;
  v_client_row_id text;
  v_before jsonb;
  v_after jsonb;
  v_action text;
  v_status text;
  v_field text;
  v_billing_status text;
  v_saved_analysis_count bigint;
  v_validated_evidence jsonb;
  v_validated_sources jsonb;
  v_validated_evidence_count integer;
  v_validated_confidence numeric;
  v_component_taxonomy_id uuid;
  v_failure_mode_taxonomy_id uuid;
  v_existing record;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'save_fmea_analysis_transaction requires service_role';
  END IF;

  IF jsonb_typeof(COALESCE(p_rows, '[]'::jsonb)) != 'array' THEN
    RAISE EXCEPTION 'p_rows must be a JSON array';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM app.organization_memberships om
    WHERE om.organization_id = p_organization_id
      AND om.user_account_id = p_user_account_id
      AND om.status = 'active'
      AND om.role IN ('owner', 'admin', 'member')
  ) THEN
    RAISE EXCEPTION 'User cannot mutate this workspace';
  END IF;

  -- Serialize new-analysis entitlement checks per workspace. Without the row
  -- lock, two concurrent free-plan requests can both observe zero analyses.
  SELECT organization.billing_status
  INTO v_billing_status
  FROM app.organizations AS organization
  WHERE organization.id = p_organization_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Workspace not found';
  END IF;

  IF v_analysis_id IS NULL
     AND COALESCE(v_billing_status, '') NOT IN ('active', 'comped') THEN
    SELECT count(*)
    INTO v_saved_analysis_count
    FROM app.fmea_analyses AS analysis
    WHERE analysis.organization_id = p_organization_id
      AND analysis.status <> 'archived';

    IF v_saved_analysis_count >= 1 THEN
      RAISE EXCEPTION 'FREE_PLAN_ANALYSIS_LIMIT';
    END IF;
  END IF;

  IF v_analysis_id IS NULL THEN
    INSERT INTO app.fmea_analyses (
      organization_id,
      user_account_id,
      created_by_user_account_id,
      name,
      metadata
    )
    VALUES (
      p_organization_id,
      p_user_account_id,
      p_user_account_id,
      COALESCE(NULLIF(BTRIM(p_name), ''), 'Untitled Failure Mode and Effects Analysis'),
      jsonb_build_object('rowCount', jsonb_array_length(COALESCE(p_rows, '[]'::jsonb)), 'source', 'web_editor')
    )
    RETURNING id INTO v_analysis_id;
  ELSE
    UPDATE app.fmea_analyses
    SET organization_id = p_organization_id,
        user_account_id = p_user_account_id,
        name = COALESCE(NULLIF(BTRIM(p_name), ''), name),
        metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
          'rowCount', jsonb_array_length(COALESCE(p_rows, '[]'::jsonb)),
          'source', 'web_editor'
        )
    WHERE id = v_analysis_id
      AND organization_id = p_organization_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'FMEA analysis not found in this workspace';
    END IF;
  END IF;

  FOR v_row IN
    SELECT value FROM jsonb_array_elements(COALESCE(p_rows, '[]'::jsonb))
  LOOP
    v_client_row_id := NULLIF(BTRIM(v_row->>'id'), '');
    IF v_client_row_id IS NULL THEN
      RAISE EXCEPTION 'Every FMEA row requires an id';
    END IF;

    SELECT to_jsonb(fr) INTO v_before
    FROM app.fmea_rows fr
    WHERE fr.analysis_id = v_analysis_id
      AND fr.client_row_id = v_client_row_id;

    v_status := CASE
      WHEN v_row->>'status' IN ('accepted', 'rejected') THEN v_row->>'status'
      ELSE 'needs_review'
    END;

    -- The client submits only candidate failure-mode claim IDs. Rebuild every
    -- related field, relationship, source, and displayable span from the
    -- authoritative knowledge graph so arbitrary or cross-paper lineage can
    -- never be persisted.
    SELECT COALESCE(jsonb_agg(reference.value), '[]'::jsonb)
    INTO v_validated_evidence
    FROM public.get_fmea_evidence_lineage(
      ARRAY(
        SELECT DISTINCT (candidate.value->>'claimId')::uuid
        FROM jsonb_array_elements(COALESCE(v_row->'evidence', '[]'::jsonb)) candidate(value)
        WHERE candidate.value->>'field' = 'failure_mode'
          AND COALESCE(candidate.value->>'claimId', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      )
    ) lineage
    CROSS JOIN LATERAL jsonb_array_elements(lineage.evidence) reference(value);

    SELECT
      COALESCE(jsonb_agg(DISTINCT reference.value->'source'), '[]'::jsonb),
      COUNT(DISTINCT reference.value->'source')::integer,
      AVG((reference.value->>'confidence')::numeric)
        FILTER (WHERE COALESCE(reference.value->>'confidence', '') ~ '^(0(\.[0-9]+)?|1(\.0+)?)$')
    INTO v_validated_sources, v_validated_evidence_count, v_validated_confidence
    FROM jsonb_array_elements(v_validated_evidence) reference(value)
    WHERE jsonb_typeof(reference.value->'source') = 'object';

    SELECT link.component_id
    INTO v_component_taxonomy_id
    FROM jsonb_array_elements(v_validated_evidence) reference(value)
    JOIN knowledge.claim_component_links link
      ON link.evidence_claim_id = (reference.value->>'claimId')::uuid
      AND link.review_status != 'rejected'
    JOIN knowledge.components node ON node.id = link.component_id AND node.is_active = true
    WHERE reference.value->>'field' = 'component'
    ORDER BY (link.review_status = 'accepted') DESC, link.confidence DESC, node.depth DESC
    LIMIT 1;

    SELECT link.failure_mode_id
    INTO v_failure_mode_taxonomy_id
    FROM jsonb_array_elements(v_validated_evidence) reference(value)
    JOIN knowledge.claim_failure_mode_links link
      ON link.evidence_claim_id = (reference.value->>'claimId')::uuid
      AND link.review_status != 'rejected'
    JOIN knowledge.failure_modes node ON node.id = link.failure_mode_id AND node.is_active = true
    WHERE reference.value->>'field' = 'failure_mode'
    ORDER BY (link.review_status = 'accepted') DESC, link.confidence DESC, node.depth DESC
    LIMIT 1;

    INSERT INTO app.fmea_rows AS saved_row (
      analysis_id,
      client_row_id,
      component,
      function,
      failure_mode,
      effect,
      severity,
      cause,
      occurrence,
      controls,
      detection,
      detection_rating,
      recommended_action,
      responsible_owner,
      review_status,
      confidence,
      model_metadata
    )
    VALUES (
      v_analysis_id,
      v_client_row_id,
      COALESCE(NULLIF(BTRIM(v_row->>'component'), ''), 'Unspecified component'),
      COALESCE(v_row->>'function', ''),
      COALESCE(NULLIF(BTRIM(v_row->>'failureMode'), ''), 'Unspecified failure mode'),
      COALESCE(v_row->>'effect', ''),
      CASE WHEN COALESCE(v_row->>'severity', '') ~ '^(10|[1-9])$' THEN (v_row->>'severity')::smallint END,
      COALESCE(v_row->>'cause', ''),
      CASE WHEN COALESCE(v_row->>'occurrence', '') ~ '^(10|[1-9])$' THEN (v_row->>'occurrence')::smallint END,
      COALESCE(v_row->>'currentControl', ''),
      '',
      CASE WHEN COALESCE(v_row->>'detection', '') ~ '^(10|[1-9])$' THEN (v_row->>'detection')::smallint END,
      COALESCE(v_row->>'correctiveAction', ''),
      COALESCE(v_row->>'owner', ''),
      v_status,
      v_validated_confidence,
      jsonb_build_object(
        'clientRowId', v_client_row_id,
        'evidenceCount', v_validated_evidence_count,
        'included', COALESCE((v_row->>'included')::boolean, true),
        'industry', COALESCE(v_row->>'industry', ''),
        'requirement', COALESCE(v_row->>'requirement', ''),
        'rowOrder', COALESCE((v_row->>'rowOrder')::int, 0),
        'rpn', COALESCE(v_row->>'rpn', ''),
        'sources', v_validated_sources,
        'evidence', v_validated_evidence,
        'componentTaxonomyId', v_component_taxonomy_id,
        'failureModeTaxonomyId', v_failure_mode_taxonomy_id,
        'scoreSuggestions', COALESCE(v_row->'scoreSuggestions', '{}'::jsonb)
      )
    )
    ON CONFLICT (analysis_id, client_row_id) DO UPDATE
    SET component = EXCLUDED.component,
        function = EXCLUDED.function,
        failure_mode = EXCLUDED.failure_mode,
        effect = EXCLUDED.effect,
        severity = EXCLUDED.severity,
        cause = EXCLUDED.cause,
        occurrence = EXCLUDED.occurrence,
        controls = EXCLUDED.controls,
        detection = EXCLUDED.detection,
        detection_rating = EXCLUDED.detection_rating,
        recommended_action = EXCLUDED.recommended_action,
        responsible_owner = EXCLUDED.responsible_owner,
        review_status = EXCLUDED.review_status,
        confidence = EXCLUDED.confidence,
        model_metadata = EXCLUDED.model_metadata
    RETURNING saved_row.id, to_jsonb(saved_row) INTO v_row_id, v_after;

    DELETE FROM app.fmea_row_evidence WHERE fmea_row_id = v_row_id;

    FOR v_evidence IN
      SELECT value FROM jsonb_array_elements(v_validated_evidence)
    LOOP
      v_field := v_evidence->>'field';
      IF v_field IS NULL OR v_field NOT IN ('component', 'failure_mode', 'effect', 'cause', 'controls', 'detection', 'recommended_action') THEN
        CONTINUE;
      END IF;

      IF COALESCE(v_evidence->>'claimId', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
        INSERT INTO app.fmea_row_evidence (
          fmea_row_id,
          fmea_field,
          evidence_claim_id,
          claim_relationship_id,
          confidence,
          contribution_type
        )
        SELECT
          v_row_id,
          v_field,
          validated_claim.id,
          validated_relationship.id,
          CASE WHEN COALESCE(v_evidence->>'confidence', '') ~ '^(0(\.[0-9]+)?|1(\.0+)?)$' THEN (v_evidence->>'confidence')::numeric END,
          'supporting_claim'
        FROM knowledge.evidence_claims validated_claim
        JOIN knowledge.classification_jobs validated_job
          ON validated_job.id = validated_claim.classification_job_id
          AND validated_job.status = 'completed'
          AND validated_job.classifier_metadata->>'extractor' = 'llm'
        JOIN papers_raw.paper_candidates validated_paper
          ON validated_paper.id = validated_claim.paper_candidate_id
          AND validated_paper.lifecycle_status <> 'removed'
        LEFT JOIN knowledge.claim_relationships validated_relationship
          ON COALESCE(v_evidence->>'relationshipId', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          AND validated_relationship.id = (v_evidence->>'relationshipId')::uuid
          AND validated_relationship.classification_job_id = validated_claim.classification_job_id
          AND validated_relationship.paper_candidate_id = validated_claim.paper_candidate_id
          AND validated_relationship.review_status NOT IN ('rejected', 'superseded')
        WHERE validated_claim.id = (v_evidence->>'claimId')::uuid
          AND validated_claim.review_status NOT IN ('rejected', 'superseded')
          AND validated_claim.claim_type = CASE v_field
            WHEN 'component' THEN 'component'
            WHEN 'failure_mode' THEN 'failure_mode'
            WHEN 'effect' THEN 'effect'
            WHEN 'cause' THEN 'cause'
            WHEN 'controls' THEN 'control'
            WHEN 'detection' THEN 'detection_method'
            WHEN 'recommended_action' THEN 'corrective_action'
          END
          AND (
            (v_field = 'failure_mode' AND validated_relationship.id IS NULL)
            OR (v_field = 'component'
                AND validated_relationship.relationship_type = 'has_failure_mode'
                AND validated_relationship.subject_claim_id = validated_claim.id)
            OR (v_field = 'cause'
                AND validated_relationship.relationship_type = 'caused_by'
                AND validated_relationship.object_claim_id = validated_claim.id)
            OR (v_field = 'effect'
                AND validated_relationship.relationship_type = 'has_effect'
                AND validated_relationship.object_claim_id = validated_claim.id)
            OR (v_field = 'controls'
                AND validated_relationship.relationship_type = 'mitigated_by'
                AND validated_relationship.object_claim_id = validated_claim.id)
            OR (v_field = 'detection'
                AND validated_relationship.relationship_type = 'detected_by'
                AND validated_relationship.object_claim_id = validated_claim.id)
            OR (v_field = 'recommended_action'
                AND validated_relationship.relationship_type = 'corrected_by'
                AND validated_relationship.object_claim_id = validated_claim.id)
          );
      END IF;

      FOR v_span IN
        SELECT value FROM jsonb_array_elements(COALESCE(v_evidence->'spans', '[]'::jsonb))
      LOOP
        IF COALESCE(v_span->>'id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
           AND COALESCE(v_evidence->>'claimId', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
           AND EXISTS (
             SELECT 1
             FROM knowledge.evidence_spans safe_span
             WHERE safe_span.id = (v_span->>'id')::uuid
               AND safe_span.evidence_claim_id = (v_evidence->>'claimId')::uuid
               AND safe_span.license_safe = true
           ) THEN
          INSERT INTO app.fmea_row_evidence (
            fmea_row_id,
            fmea_field,
            evidence_claim_id,
            evidence_span_id,
            confidence,
            contribution_type
          )
          VALUES (
            v_row_id,
            v_field,
            (v_evidence->>'claimId')::uuid,
            (v_span->>'id')::uuid,
            CASE WHEN COALESCE(v_evidence->>'confidence', '') ~ '^(0(\.[0-9]+)?|1(\.0+)?)$' THEN (v_evidence->>'confidence')::numeric END,
            'source_span'
          );
        END IF;
      END LOOP;
    END LOOP;

    v_action := CASE
      WHEN v_before IS NULL THEN 'created'
      WHEN v_before->>'review_status' IS DISTINCT FROM v_status AND v_status = 'accepted' THEN 'accepted'
      WHEN v_before->>'review_status' IS DISTINCT FROM v_status AND v_status = 'rejected' THEN 'rejected'
      WHEN (v_before - 'updated_at') IS DISTINCT FROM (v_after - 'updated_at') THEN 'edited'
      ELSE NULL
    END;

    IF v_action IS NOT NULL THEN
      INSERT INTO app.fmea_review_events (
        fmea_row_id,
        user_account_id,
        organization_id,
        action,
        before_state,
        after_state
      )
      VALUES (v_row_id, p_user_account_id, p_organization_id, v_action, v_before, v_after);
    END IF;
  END LOOP;

  FOR v_existing IN
    SELECT fr.id, to_jsonb(fr) AS before_state
    FROM app.fmea_rows fr
    WHERE fr.analysis_id = v_analysis_id
      AND fr.review_status != 'superseded'
      AND NOT EXISTS (
        SELECT 1
        FROM jsonb_array_elements(COALESCE(p_rows, '[]'::jsonb)) item
        WHERE item->>'id' = fr.client_row_id
      )
  LOOP
    UPDATE app.fmea_rows AS superseded_row
    SET review_status = 'superseded',
        model_metadata = COALESCE(model_metadata, '{}'::jsonb) || '{"included": false}'::jsonb
    WHERE id = v_existing.id
    RETURNING to_jsonb(superseded_row) INTO v_after;

    INSERT INTO app.fmea_review_events (
      fmea_row_id,
      user_account_id,
      organization_id,
      action,
      before_state,
      after_state
    )
    VALUES (v_existing.id, p_user_account_id, p_organization_id, 'superseded', v_existing.before_state, v_after);
  END LOOP;

  RETURN v_analysis_id;
END;
$$;

REVOKE ALL ON FUNCTION public.save_fmea_analysis_transaction(uuid, uuid, uuid, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.save_fmea_analysis_transaction(uuid, uuid, uuid, text, jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.save_fmea_analysis_transaction(uuid, uuid, uuid, text, jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.save_fmea_analysis_transaction(uuid, uuid, uuid, text, jsonb) TO service_role;
