-- Bound the complete worksheet transaction at the database trust boundary and
-- enrich evidence lineage with the exact classifier runtime that produced it.

ALTER FUNCTION public.save_fmea_analysis_transaction(uuid, uuid, uuid, text, jsonb)
  RENAME TO save_fmea_analysis_transaction_impl;

REVOKE ALL ON FUNCTION public.save_fmea_analysis_transaction_impl(uuid, uuid, uuid, text, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_fmea_analysis_transaction_impl(uuid, uuid, uuid, text, jsonb)
  TO service_role;

CREATE FUNCTION public.save_fmea_analysis_transaction(
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
  v_rows jsonb := COALESCE(p_rows, '[]'::jsonb);
  v_analysis_id uuid;
  v_row jsonb;
  v_saved_row_id uuid;
  v_invalidated_fields text[];
  v_has_engineer_edits boolean;
  v_filtered_evidence jsonb;
  v_filtered_sources jsonb;
  v_evidence_count integer;
  v_confidence numeric;
  v_metadata_patch jsonb;
  v_before jsonb;
  v_after jsonb;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'save_fmea_analysis_transaction requires service_role';
  END IF;
  IF jsonb_typeof(v_rows) != 'array' THEN
    RAISE EXCEPTION 'p_rows must be a JSON array';
  END IF;
  IF pg_column_size(v_rows) > 2000000 THEN
    RAISE EXCEPTION 'FMEA payload exceeds 2000000 bytes';
  END IF;
  IF jsonb_array_length(v_rows) > 1000 THEN
    RAISE EXCEPTION 'FMEA payload exceeds 1000 rows';
  END IF;
  IF length(COALESCE(p_name, '')) > 200 THEN
    RAISE EXCEPTION 'FMEA analysis name exceeds 200 characters';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(v_rows) AS item(value)
    WHERE jsonb_typeof(item.value) != 'object'
       OR length(COALESCE(item.value->>'id', '')) = 0
       OR length(COALESCE(item.value->>'id', '')) > 10000
       OR length(COALESCE(item.value->>'component', '')) > 10000
       OR length(COALESCE(item.value->>'function', '')) > 10000
       OR length(COALESCE(item.value->>'requirement', '')) > 10000
       OR length(COALESCE(item.value->>'industry', '')) > 10000
       OR length(COALESCE(item.value->>'failureMode', '')) > 10000
       OR length(COALESCE(item.value->>'effect', '')) > 10000
       OR length(COALESCE(item.value->>'cause', '')) > 10000
       OR length(COALESCE(item.value->>'currentControl', '')) > 10000
       OR length(COALESCE(item.value->>'correctiveAction', '')) > 10000
       OR length(COALESCE(item.value->>'owner', '')) > 10000
       OR (
         item.value ? 'evidence'
         AND CASE
           WHEN jsonb_typeof(item.value->'evidence') = 'array'
             THEN jsonb_array_length(item.value->'evidence') > 100
           ELSE true
         END
       )
       OR (
         item.value ? 'engineerEditedFields'
         AND CASE
           WHEN jsonb_typeof(item.value->'engineerEditedFields') = 'array' THEN EXISTS (
             SELECT 1
             FROM jsonb_array_elements(item.value->'engineerEditedFields') AS edited(value)
             WHERE jsonb_typeof(edited.value) != 'string'
                OR length(edited.value #>> '{}') > 100
                OR edited.value #>> '{}' NOT IN (
                  'component', 'function', 'requirement', 'industry',
                  'failureMode', 'effect', 'severity', 'cause', 'occurrence',
                  'currentControl', 'detection', 'correctiveAction'
                )
           )
           ELSE true
         END
       )
       OR (
         item.value ? 'domains'
         AND CASE
           WHEN jsonb_typeof(item.value->'domains') = 'array' THEN
             jsonb_array_length(item.value->'domains') > 50 OR EXISTS (
               SELECT 1 FROM jsonb_array_elements(item.value->'domains') AS domain(value)
               WHERE jsonb_typeof(domain.value) != 'string' OR length(domain.value #>> '{}') > 500
             )
           ELSE true
         END
       )
       OR (
         item.value ? 'operatingContexts'
         AND CASE
           WHEN jsonb_typeof(item.value->'operatingContexts') = 'array' THEN
             jsonb_array_length(item.value->'operatingContexts') > 50 OR EXISTS (
               SELECT 1 FROM jsonb_array_elements(item.value->'operatingContexts') AS context(value)
               WHERE jsonb_typeof(context.value) != 'string' OR length(context.value #>> '{}') > 1000
             )
           ELSE true
         END
       )
  ) THEN
    RAISE EXCEPTION 'FMEA row payload is invalid or exceeds field/evidence limits';
  END IF;

  v_analysis_id := public.save_fmea_analysis_transaction_impl(
    p_analysis_id,
    p_organization_id,
    p_user_account_id,
    p_name,
    v_rows
  );

  -- The original transaction rebuilds complete lineage from each submitted
  -- failure-mode claim. Strip fields an engineer changed so stale machine
  -- evidence cannot be silently reattached to edited content, then persist the
  -- review/provenance metadata added by the product workflow.
  FOR v_row IN SELECT value FROM jsonb_array_elements(v_rows)
  LOOP
    v_has_engineer_edits := CASE
      WHEN jsonb_typeof(v_row->'engineerEditedFields') = 'array'
        THEN jsonb_array_length(v_row->'engineerEditedFields') > 0
      ELSE false
    END;
    SELECT COALESCE(array_agg(DISTINCT mapped.field) FILTER (WHERE mapped.field IS NOT NULL), ARRAY[]::text[])
    INTO v_invalidated_fields
    FROM jsonb_array_elements_text(
      CASE WHEN jsonb_typeof(v_row->'engineerEditedFields') = 'array'
        THEN v_row->'engineerEditedFields' ELSE '[]'::jsonb END
    ) AS edited(value)
    CROSS JOIN LATERAL (
      SELECT CASE edited.value
        WHEN 'component' THEN 'component'
        WHEN 'failureMode' THEN 'failure_mode'
        WHEN 'effect' THEN 'effect'
        WHEN 'cause' THEN 'cause'
        WHEN 'currentControl' THEN 'controls'
        WHEN 'correctiveAction' THEN 'recommended_action'
      END AS field
    ) mapped;

    SELECT saved.id, to_jsonb(saved)
    INTO v_saved_row_id, v_before
    FROM app.fmea_rows saved
    WHERE saved.analysis_id = v_analysis_id
      AND saved.client_row_id = v_row->>'id'
    FOR UPDATE;
    IF NOT FOUND THEN CONTINUE; END IF;

    SELECT COALESCE(jsonb_agg(reference.value ORDER BY reference.ordinality), '[]'::jsonb)
    INTO v_filtered_evidence
    FROM jsonb_array_elements(COALESCE(v_before->'model_metadata'->'evidence', '[]'::jsonb))
      WITH ORDINALITY AS reference(value, ordinality)
    WHERE NOT (COALESCE(reference.value->>'field', '') = ANY(v_invalidated_fields));

    SELECT COALESCE(jsonb_agg(source.value), '[]'::jsonb), count(*)::integer
    INTO v_filtered_sources, v_evidence_count
    FROM (
      SELECT DISTINCT reference.value->'source' AS value
      FROM jsonb_array_elements(v_filtered_evidence) AS reference(value)
      WHERE jsonb_typeof(reference.value->'source') = 'object'
    ) source;

    SELECT avg((reference.value->>'confidence')::numeric)
      FILTER (WHERE COALESCE(reference.value->>'confidence', '') ~ '^(0(\.[0-9]+)?|1(\.0+)?)$')
    INTO v_confidence
    FROM jsonb_array_elements(v_filtered_evidence) AS reference(value);

    v_metadata_patch := jsonb_build_object(
      'evidence', v_filtered_evidence,
      'sources', v_filtered_sources,
      'evidenceCount', v_evidence_count,
      'domains', CASE WHEN jsonb_typeof(v_row->'domains') = 'array' THEN v_row->'domains' ELSE '[]'::jsonb END,
      'operatingContexts', CASE WHEN jsonb_typeof(v_row->'operatingContexts') = 'array' THEN v_row->'operatingContexts' ELSE '[]'::jsonb END,
      'provenance', CASE WHEN v_row->>'provenance' = 'manual' THEN 'manual' ELSE 'evidence' END,
      'engineerEditedFields', CASE WHEN jsonb_typeof(v_row->'engineerEditedFields') = 'array' THEN v_row->'engineerEditedFields' ELSE '[]'::jsonb END,
      'reviewedAt', CASE
        WHEN (v_has_engineer_edits AND v_row->>'status' NOT IN ('accepted', 'rejected'))
          OR v_row->>'status' = 'edited' THEN 'null'::jsonb
        ELSE COALESCE(v_row->'reviewedAt', 'null'::jsonb)
      END,
      'componentTaxonomyId', CASE WHEN 'component' = ANY(v_invalidated_fields) THEN 'null'::jsonb ELSE v_before->'model_metadata'->'componentTaxonomyId' END,
      'failureModeTaxonomyId', CASE WHEN 'failure_mode' = ANY(v_invalidated_fields) THEN 'null'::jsonb ELSE v_before->'model_metadata'->'failureModeTaxonomyId' END
    );

    DELETE FROM app.fmea_row_evidence
    WHERE fmea_row_id = v_saved_row_id
      AND fmea_field = ANY(v_invalidated_fields);

    UPDATE app.fmea_rows saved
    SET review_status = CASE
          WHEN (v_has_engineer_edits AND v_row->>'status' NOT IN ('accepted', 'rejected'))
            OR v_row->>'status' = 'edited' THEN 'edited'
          ELSE saved.review_status
        END,
        confidence = v_confidence,
        model_metadata = COALESCE(saved.model_metadata, '{}'::jsonb) || v_metadata_patch
    WHERE saved.id = v_saved_row_id
    RETURNING to_jsonb(saved) INTO v_after;

    IF v_before IS DISTINCT FROM v_after THEN
      INSERT INTO app.fmea_review_events (
        fmea_row_id, user_account_id, organization_id, action, before_state, after_state
      ) VALUES (
        v_saved_row_id, p_user_account_id, p_organization_id, 'edited', v_before, v_after
      );
    END IF;
  END LOOP;

  RETURN v_analysis_id;
END;
$$;

REVOKE ALL ON FUNCTION public.save_fmea_analysis_transaction(uuid, uuid, uuid, text, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_fmea_analysis_transaction(uuid, uuid, uuid, text, jsonb)
  TO service_role;

ALTER FUNCTION public.get_fmea_evidence_lineage(uuid[])
  RENAME TO get_fmea_evidence_lineage_base;

REVOKE ALL ON FUNCTION public.get_fmea_evidence_lineage_base(uuid[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_fmea_evidence_lineage_base(uuid[]) TO service_role;

CREATE FUNCTION public.get_fmea_evidence_lineage(
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
  SELECT
    base.failure_mode_claim_id,
    COALESCE((
      SELECT jsonb_agg(
        reference.value || jsonb_strip_nulls(jsonb_build_object(
          'inferenceRationale', claim.inference_rationale,
          'classifierVersion', job.classifier_version,
          'llmProvider', COALESCE(
            job.classifier_metadata->>'llm_provider',
            job.classifier_metadata->>'provider'
          ),
          'llmModel', COALESCE(
            job.classifier_metadata->>'llm_model',
            job.classifier_metadata->>'model'
          )
        ))
        ORDER BY reference.ordinality
      )
      FROM jsonb_array_elements(COALESCE(base.evidence, '[]'::jsonb))
        WITH ORDINALITY AS reference(value, ordinality)
      LEFT JOIN knowledge.evidence_claims claim
        ON COALESCE(reference.value->>'claimId', '') ~*
          '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        AND claim.id = (reference.value->>'claimId')::uuid
      LEFT JOIN knowledge.classification_jobs job
        ON job.id = claim.classification_job_id
    ), '[]'::jsonb) AS evidence
  FROM public.get_fmea_evidence_lineage_base(p_failure_mode_claim_ids) AS base
  WHERE auth.role() IN ('authenticated', 'service_role');
$$;

REVOKE ALL ON FUNCTION public.get_fmea_evidence_lineage(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_fmea_evidence_lineage(uuid[]) TO authenticated, service_role;
