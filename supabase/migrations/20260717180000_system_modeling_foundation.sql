-- Tenant-defined system models: component instances, interfaces, and failure propagation.
-- Taxonomy remains in knowledge.*; customer-specific structure and reasoning live in app.*.

ALTER TABLE app.assets
  ADD COLUMN IF NOT EXISTS updated_by_user_account_id uuid
    REFERENCES app.user_accounts(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conname = 'assets_organization_id_id_key'
      AND conrelid = 'app.assets'::regclass
  ) THEN
    ALTER TABLE app.assets
      ADD CONSTRAINT assets_organization_id_id_key UNIQUE (organization_id, id);
  END IF;
END
$$;

CREATE TABLE app.asset_component_instances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES app.organizations(id) ON DELETE CASCADE,
  asset_id uuid NOT NULL REFERENCES app.assets(id) ON DELETE CASCADE,
  parent_instance_id uuid,
  component_id uuid NOT NULL REFERENCES knowledge.components(id) ON DELETE RESTRICT,
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 160),
  instance_key text CHECK (
    instance_key IS NULL
    OR instance_key ~ '^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,79}$'
  ),
  node_kind text NOT NULL DEFAULT 'component'
    CHECK (node_kind IN ('system', 'subsystem', 'assembly', 'component')),
  function_text text CHECK (function_text IS NULL OR char_length(function_text) <= 1000),
  criticality text NOT NULL DEFAULT 'unrated'
    CHECK (criticality IN ('unrated', 'low', 'medium', 'high', 'safety_critical')),
  operating_context jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by_user_account_id uuid REFERENCES app.user_accounts(id) ON DELETE SET NULL,
  updated_by_user_account_id uuid REFERENCES app.user_accounts(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (asset_id, id),
  UNIQUE (asset_id, instance_key),
  FOREIGN KEY (organization_id, asset_id)
    REFERENCES app.assets(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (asset_id, parent_instance_id)
    REFERENCES app.asset_component_instances(asset_id, id) ON DELETE CASCADE,
  CHECK (parent_instance_id IS NULL OR parent_instance_id <> id)
);

CREATE INDEX asset_component_instances_org_asset_idx
  ON app.asset_component_instances(organization_id, asset_id);
CREATE INDEX asset_component_instances_parent_idx
  ON app.asset_component_instances(parent_instance_id);
CREATE INDEX asset_component_instances_component_idx
  ON app.asset_component_instances(component_id);

CREATE TABLE app.asset_dependencies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES app.organizations(id) ON DELETE CASCADE,
  asset_id uuid NOT NULL REFERENCES app.assets(id) ON DELETE CASCADE,
  source_instance_id uuid NOT NULL,
  target_instance_id uuid NOT NULL,
  dependency_type text NOT NULL
    CHECK (dependency_type IN (
      'mechanical', 'electrical', 'fluid', 'thermal', 'control',
      'structural', 'data', 'other'
    )),
  direction text NOT NULL DEFAULT 'directed'
    CHECK (direction IN ('directed', 'bidirectional')),
  name text CHECK (name IS NULL OR char_length(name) <= 160),
  description text CHECK (description IS NULL OR char_length(description) <= 2000),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by_user_account_id uuid REFERENCES app.user_accounts(id) ON DELETE SET NULL,
  updated_by_user_account_id uuid REFERENCES app.user_accounts(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, asset_id)
    REFERENCES app.assets(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (asset_id, source_instance_id)
    REFERENCES app.asset_component_instances(asset_id, id) ON DELETE CASCADE,
  FOREIGN KEY (asset_id, target_instance_id)
    REFERENCES app.asset_component_instances(asset_id, id) ON DELETE CASCADE,
  CHECK (source_instance_id <> target_instance_id),
  UNIQUE (asset_id, source_instance_id, target_instance_id, dependency_type)
);

CREATE INDEX asset_dependencies_org_asset_idx
  ON app.asset_dependencies(organization_id, asset_id);
CREATE INDEX asset_dependencies_source_idx
  ON app.asset_dependencies(source_instance_id);
CREATE INDEX asset_dependencies_target_idx
  ON app.asset_dependencies(target_instance_id);

CREATE TABLE app.asset_failure_propagations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES app.organizations(id) ON DELETE CASCADE,
  asset_id uuid NOT NULL REFERENCES app.assets(id) ON DELETE CASCADE,
  source_instance_id uuid NOT NULL,
  target_instance_id uuid NOT NULL,
  source_failure_mode_id uuid NOT NULL
    REFERENCES knowledge.failure_modes(id) ON DELETE RESTRICT,
  target_effect text NOT NULL CHECK (char_length(btrim(target_effect)) BETWEEN 1 AND 1000),
  trigger_condition text CHECK (trigger_condition IS NULL OR char_length(trigger_condition) <= 1000),
  likelihood text NOT NULL DEFAULT 'unknown'
    CHECK (likelihood IN ('unknown', 'low', 'medium', 'high')),
  confidence numeric(5,4)
    CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  rationale text NOT NULL CHECK (char_length(btrim(rationale)) BETWEEN 1 AND 3000),
  evidence_claim_id uuid REFERENCES knowledge.evidence_claims(id) ON DELETE RESTRICT,
  claim_relationship_id uuid REFERENCES knowledge.claim_relationships(id) ON DELETE RESTRICT,
  evidence_span_id uuid REFERENCES knowledge.evidence_spans(id) ON DELETE RESTRICT,
  review_status text NOT NULL DEFAULT 'needs_review'
    CHECK (review_status IN ('needs_review', 'accepted', 'rejected', 'superseded')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by_user_account_id uuid REFERENCES app.user_accounts(id) ON DELETE SET NULL,
  updated_by_user_account_id uuid REFERENCES app.user_accounts(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, asset_id)
    REFERENCES app.assets(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (asset_id, source_instance_id)
    REFERENCES app.asset_component_instances(asset_id, id) ON DELETE CASCADE,
  FOREIGN KEY (asset_id, target_instance_id)
    REFERENCES app.asset_component_instances(asset_id, id) ON DELETE CASCADE,
  CHECK (source_instance_id <> target_instance_id),
  CHECK (
    (evidence_claim_id IS NULL AND claim_relationship_id IS NULL AND evidence_span_id IS NULL)
    OR
    (evidence_claim_id IS NOT NULL AND claim_relationship_id IS NOT NULL AND evidence_span_id IS NOT NULL)
  ),
  UNIQUE (asset_id, source_instance_id, target_instance_id, source_failure_mode_id)
);

CREATE INDEX asset_failure_propagations_org_asset_idx
  ON app.asset_failure_propagations(organization_id, asset_id);
CREATE INDEX asset_failure_propagations_source_idx
  ON app.asset_failure_propagations(source_instance_id);
CREATE INDEX asset_failure_propagations_target_idx
  ON app.asset_failure_propagations(target_instance_id);
CREATE INDEX asset_failure_propagations_failure_mode_idx
  ON app.asset_failure_propagations(source_failure_mode_id);
CREATE INDEX asset_failure_propagations_evidence_claim_idx
  ON app.asset_failure_propagations(evidence_claim_id)
  WHERE evidence_claim_id IS NOT NULL;

CREATE TABLE app.system_model_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES app.organizations(id) ON DELETE CASCADE,
  -- Deliberately not an FK: audit history must survive deletion of the modeled asset.
  asset_id uuid,
  actor_user_account_id uuid REFERENCES app.user_accounts(id) ON DELETE SET NULL,
  entity_type text NOT NULL
    CHECK (entity_type IN ('asset', 'component_instance', 'dependency', 'failure_propagation')),
  entity_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('created', 'updated', 'deleted')),
  before_state jsonb,
  after_state jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX system_model_audit_events_org_asset_idx
  ON app.system_model_audit_events(organization_id, asset_id, created_at DESC);
CREATE INDEX system_model_audit_events_entity_idx
  ON app.system_model_audit_events(entity_type, entity_id, created_at DESC);

CREATE OR REPLACE FUNCTION app.prevent_asset_component_cycle()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  IF NEW.parent_instance_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.parent_instance_id = NEW.id THEN
    RAISE EXCEPTION 'A component instance cannot be its own parent';
  END IF;

  IF EXISTS (
    WITH RECURSIVE ancestors AS (
      SELECT instance.id, instance.parent_instance_id
      FROM app.asset_component_instances AS instance
      WHERE instance.asset_id = NEW.asset_id
        AND instance.id = NEW.parent_instance_id

      UNION ALL

      SELECT parent.id, parent.parent_instance_id
      FROM app.asset_component_instances AS parent
      JOIN ancestors ON ancestors.parent_instance_id = parent.id
      WHERE parent.asset_id = NEW.asset_id
    )
    SELECT 1 FROM ancestors WHERE id = NEW.id
  ) THEN
    RAISE EXCEPTION 'A component hierarchy cannot contain a cycle';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER prevent_asset_component_cycle
  BEFORE INSERT OR UPDATE OF parent_instance_id, asset_id
  ON app.asset_component_instances
  FOR EACH ROW EXECUTE FUNCTION app.prevent_asset_component_cycle();

CREATE OR REPLACE FUNCTION app.validate_failure_propagation_evidence()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
DECLARE
  matched_relationship_id uuid;
  matched_span_id uuid;
BEGIN
  -- Rejection must remain possible even if upstream evidence was later withdrawn.
  IF TG_OP = 'UPDATE'
    AND NEW.review_status = 'rejected'
    AND NEW.evidence_claim_id IS NOT DISTINCT FROM OLD.evidence_claim_id
    AND NEW.claim_relationship_id IS NOT DISTINCT FROM OLD.claim_relationship_id
    AND NEW.evidence_span_id IS NOT DISTINCT FROM OLD.evidence_span_id
    AND NEW.source_instance_id IS NOT DISTINCT FROM OLD.source_instance_id
    AND NEW.source_failure_mode_id IS NOT DISTINCT FROM OLD.source_failure_mode_id
    AND NEW.asset_id IS NOT DISTINCT FROM OLD.asset_id
  THEN
    RETURN NEW;
  END IF;

  IF NEW.evidence_claim_id IS NULL THEN
    NEW.claim_relationship_id := NULL;
    NEW.evidence_span_id := NULL;
    RETURN NEW;
  END IF;

  SELECT relationship.id, safe_span.id
  INTO matched_relationship_id, matched_span_id
  FROM app.asset_component_instances AS source_instance
  JOIN knowledge.components AS source_component
    ON source_component.id = source_instance.component_id
    AND source_component.is_active = true
  JOIN knowledge.failure_modes AS selected_failure_mode
    ON selected_failure_mode.id = NEW.source_failure_mode_id
    AND selected_failure_mode.is_active = true
  JOIN knowledge.claim_relationships AS relationship
    ON relationship.relationship_type = 'has_failure_mode'
    AND relationship.object_claim_id = NEW.evidence_claim_id
    AND relationship.review_status NOT IN ('rejected', 'superseded')
  JOIN knowledge.classification_jobs AS job
    ON job.id = relationship.classification_job_id
    AND job.status = 'completed'
    AND job.classifier_metadata->>'extractor' = 'llm'
  JOIN knowledge.evidence_claims AS component_claim
    ON component_claim.id = relationship.subject_claim_id
    AND component_claim.classification_job_id = relationship.classification_job_id
    AND component_claim.claim_type = 'component'
    AND component_claim.review_status NOT IN ('rejected', 'superseded')
  JOIN knowledge.evidence_claims AS failure_mode_claim
    ON failure_mode_claim.id = relationship.object_claim_id
    AND failure_mode_claim.classification_job_id = relationship.classification_job_id
    AND failure_mode_claim.claim_type = 'failure_mode'
    AND failure_mode_claim.review_status NOT IN ('rejected', 'superseded')
  JOIN knowledge.claim_component_links AS component_link
    ON component_link.evidence_claim_id = component_claim.id
    AND component_link.review_status != 'rejected'
  JOIN knowledge.components AS evidence_component
    ON evidence_component.id = component_link.component_id
    AND evidence_component.is_active = true
    AND (
      evidence_component.path = source_component.path
      OR evidence_component.path LIKE source_component.path || '/%'
    )
  JOIN knowledge.claim_failure_mode_links AS failure_mode_link
    ON failure_mode_link.evidence_claim_id = failure_mode_claim.id
    AND failure_mode_link.review_status != 'rejected'
  JOIN knowledge.failure_modes AS evidence_failure_mode
    ON evidence_failure_mode.id = failure_mode_link.failure_mode_id
    AND evidence_failure_mode.is_active = true
    AND (
      evidence_failure_mode.path = selected_failure_mode.path
      OR evidence_failure_mode.path LIKE selected_failure_mode.path || '/%'
    )
  JOIN LATERAL (
    SELECT span.id
    FROM knowledge.evidence_spans AS span
    WHERE span.evidence_claim_id = failure_mode_claim.id
      AND span.license_safe = true
    ORDER BY span.char_start NULLS LAST, span.id
    LIMIT 1
  ) AS safe_span ON true
  WHERE source_instance.id = NEW.source_instance_id
    AND source_instance.asset_id = NEW.asset_id
    AND source_instance.organization_id = NEW.organization_id
  ORDER BY
    CASE relationship.review_status WHEN 'accepted' THEN 0 ELSE 1 END,
    relationship.confidence DESC NULLS LAST,
    relationship.id
  LIMIT 1;

  IF matched_relationship_id IS NULL OR matched_span_id IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Evidence claim does not support this component and failure-mode propagation';
  END IF;

  NEW.claim_relationship_id := matched_relationship_id;
  NEW.evidence_span_id := matched_span_id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER validate_failure_propagation_evidence
  BEFORE INSERT OR UPDATE OF evidence_claim_id, claim_relationship_id,
    evidence_span_id, source_instance_id, source_failure_mode_id, asset_id, review_status
  ON app.asset_failure_propagations
  FOR EACH ROW EXECUTE FUNCTION app.validate_failure_propagation_evidence();

CREATE OR REPLACE FUNCTION app.audit_system_model_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  before_payload jsonb;
  after_payload jsonb;
  active_payload jsonb;
  event_organization_id uuid;
  event_asset_id uuid;
  event_actor_id uuid;
  event_entity_type text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    after_payload := to_jsonb(NEW);
    active_payload := after_payload;
  ELSIF TG_OP = 'UPDATE' THEN
    before_payload := to_jsonb(OLD);
    after_payload := to_jsonb(NEW);
    active_payload := after_payload;
  ELSE
    before_payload := to_jsonb(OLD);
    active_payload := before_payload;
  END IF;

  IF TG_TABLE_NAME = 'assets' THEN
    IF coalesce(active_payload->'metadata'->>'system_model', 'false') <> 'true' THEN
      IF TG_OP = 'DELETE' THEN
        RETURN OLD;
      END IF;
      RETURN NEW;
    END IF;
    event_entity_type := 'asset';
    event_asset_id := (active_payload->>'id')::uuid;
  ELSIF TG_TABLE_NAME = 'asset_component_instances' THEN
    event_entity_type := 'component_instance';
    event_asset_id := (active_payload->>'asset_id')::uuid;
  ELSIF TG_TABLE_NAME = 'asset_dependencies' THEN
    event_entity_type := 'dependency';
    event_asset_id := (active_payload->>'asset_id')::uuid;
  ELSE
    event_entity_type := 'failure_propagation';
    event_asset_id := (active_payload->>'asset_id')::uuid;
  END IF;

  event_organization_id := (active_payload->>'organization_id')::uuid;
  event_actor_id := coalesce(
    nullif(pg_catalog.current_setting('app.system_model_actor', true), '')::uuid,
    nullif(active_payload->>'updated_by_user_account_id', '')::uuid,
    nullif(active_payload->>'created_by_user_account_id', '')::uuid
  );

  INSERT INTO app.system_model_audit_events (
    organization_id,
    asset_id,
    actor_user_account_id,
    entity_type,
    entity_id,
    action,
    before_state,
    after_state
  ) VALUES (
    event_organization_id,
    event_asset_id,
    event_actor_id,
    event_entity_type,
    (active_payload->>'id')::uuid,
    CASE TG_OP
      WHEN 'INSERT' THEN 'created'
      WHEN 'UPDATE' THEN 'updated'
      ELSE 'deleted'
    END,
    before_payload,
    after_payload
  );

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_system_model_entity(
  p_organization_id uuid,
  p_asset_id uuid,
  p_entity_type text,
  p_entity_id uuid,
  p_actor_user_account_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  deleted_count bigint;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service role required';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM app.organization_memberships AS membership
    WHERE membership.organization_id = p_organization_id
      AND membership.user_account_id = p_actor_user_account_id
      AND membership.status = 'active'
      AND membership.role IN ('owner', 'admin', 'member')
  ) THEN
    RAISE EXCEPTION 'active workspace editor required';
  END IF;

  PERFORM pg_catalog.set_config('app.system_model_actor', p_actor_user_account_id::text, true);

  CASE p_entity_type
    WHEN 'asset' THEN
      DELETE FROM app.assets
      WHERE id = p_entity_id
        AND id = p_asset_id
        AND organization_id = p_organization_id
        AND metadata @> '{"system_model":true}'::jsonb;
    WHEN 'component_instance' THEN
      DELETE FROM app.asset_component_instances
      WHERE id = p_entity_id
        AND asset_id = p_asset_id
        AND organization_id = p_organization_id;
    WHEN 'dependency' THEN
      DELETE FROM app.asset_dependencies
      WHERE id = p_entity_id
        AND asset_id = p_asset_id
        AND organization_id = p_organization_id;
    WHEN 'failure_propagation' THEN
      DELETE FROM app.asset_failure_propagations
      WHERE id = p_entity_id
        AND asset_id = p_asset_id
        AND organization_id = p_organization_id;
    ELSE
      RAISE EXCEPTION 'invalid system model entity type';
  END CASE;

  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count = 1;
END;
$$;

CREATE TRIGGER audit_system_assets
  AFTER INSERT OR UPDATE OR DELETE ON app.assets
  FOR EACH ROW EXECUTE FUNCTION app.audit_system_model_mutation();
CREATE TRIGGER audit_asset_component_instances
  AFTER INSERT OR UPDATE OR DELETE ON app.asset_component_instances
  FOR EACH ROW EXECUTE FUNCTION app.audit_system_model_mutation();
CREATE TRIGGER audit_asset_dependencies
  AFTER INSERT OR UPDATE OR DELETE ON app.asset_dependencies
  FOR EACH ROW EXECUTE FUNCTION app.audit_system_model_mutation();
CREATE TRIGGER audit_asset_failure_propagations
  AFTER INSERT OR UPDATE OR DELETE ON app.asset_failure_propagations
  FOR EACH ROW EXECUTE FUNCTION app.audit_system_model_mutation();

CREATE TRIGGER set_asset_component_instances_updated_at
  BEFORE UPDATE ON app.asset_component_instances
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER set_asset_dependencies_updated_at
  BEFORE UPDATE ON app.asset_dependencies
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
CREATE TRIGGER set_asset_failure_propagations_updated_at
  BEFORE UPDATE ON app.asset_failure_propagations
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

ALTER TABLE app.asset_component_instances ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.asset_dependencies ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.asset_failure_propagations ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.system_model_audit_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service role all asset component instances"
  ON app.asset_component_instances FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
CREATE POLICY "members can read asset component instances"
  ON app.asset_component_instances FOR SELECT
  USING (organization_id IN (SELECT app.current_organization_ids()));

CREATE POLICY "service role all asset dependencies"
  ON app.asset_dependencies FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
CREATE POLICY "members can read asset dependencies"
  ON app.asset_dependencies FOR SELECT
  USING (organization_id IN (SELECT app.current_organization_ids()));

CREATE POLICY "service role all asset failure propagations"
  ON app.asset_failure_propagations FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
CREATE POLICY "members can read asset failure propagations"
  ON app.asset_failure_propagations FOR SELECT
  USING (organization_id IN (SELECT app.current_organization_ids()));

CREATE POLICY "service role all system model audit events"
  ON app.system_model_audit_events FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
CREATE POLICY "members can read system model audit events"
  ON app.system_model_audit_events FOR SELECT
  USING (organization_id IN (SELECT app.current_organization_ids()));

GRANT SELECT ON app.asset_component_instances, app.asset_dependencies,
  app.asset_failure_propagations, app.system_model_audit_events TO authenticated;
GRANT ALL ON app.asset_component_instances, app.asset_dependencies,
  app.asset_failure_propagations, app.system_model_audit_events TO service_role;

REVOKE ALL ON FUNCTION app.prevent_asset_component_cycle() FROM PUBLIC;
REVOKE ALL ON FUNCTION app.validate_failure_propagation_evidence() FROM PUBLIC;
REVOKE ALL ON FUNCTION app.audit_system_model_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.delete_system_model_entity(uuid, uuid, text, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.prevent_asset_component_cycle() TO service_role;
GRANT EXECUTE ON FUNCTION app.validate_failure_propagation_evidence() TO service_role;
GRANT EXECUTE ON FUNCTION app.audit_system_model_mutation() TO service_role;
GRANT EXECUTE ON FUNCTION public.delete_system_model_entity(uuid, uuid, text, uuid, uuid) TO service_role;
