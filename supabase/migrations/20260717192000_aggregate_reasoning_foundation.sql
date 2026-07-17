-- Optional second-stage reasoning over a bounded, tenant-accepted aggregate graph.
-- Outputs are reviewable suggestions only and never mutate FMEA or system truth.

CREATE TABLE app.reasoning_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES app.organizations(id) ON DELETE CASCADE,
  asset_id uuid NOT NULL REFERENCES app.assets(id) ON DELETE CASCADE,
  input_hash text NOT NULL CHECK (input_hash ~ '^[0-9a-f]{64}$'),
  input_manifest jsonb NOT NULL,
  manifest_version text NOT NULL,
  prompt_version text NOT NULL,
  provider text NOT NULL,
  model text NOT NULL,
  status text NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'completed', 'failed')),
  attempts integer NOT NULL DEFAULT 1 CHECK (attempts BETWEEN 1 AND 3),
  started_at timestamptz NOT NULL DEFAULT now(),
  lease_expires_at timestamptz DEFAULT (now() + interval '15 minutes'),
  completed_at timestamptz,
  last_error text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, asset_id, input_hash, prompt_version, provider, model),
  UNIQUE (organization_id, asset_id, id),
  FOREIGN KEY (organization_id, asset_id)
    REFERENCES app.assets(organization_id, id) ON DELETE CASCADE,
  CHECK (
    (status = 'completed' AND completed_at IS NOT NULL AND last_error IS NULL
      AND lease_expires_at IS NULL)
    OR (status = 'failed' AND completed_at IS NOT NULL AND last_error IS NOT NULL
      AND lease_expires_at IS NULL)
    OR (status = 'running' AND completed_at IS NULL AND lease_expires_at IS NOT NULL)
  )
);

CREATE INDEX reasoning_jobs_org_asset_started_idx
  ON app.reasoning_jobs(organization_id, asset_id, started_at DESC);
CREATE INDEX reasoning_jobs_status_idx
  ON app.reasoning_jobs(status, started_at);
CREATE INDEX reasoning_jobs_stale_lease_idx
  ON app.reasoning_jobs(lease_expires_at)
  WHERE status = 'running';

CREATE TABLE app.reasoning_suggestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reasoning_job_id uuid NOT NULL REFERENCES app.reasoning_jobs(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES app.organizations(id) ON DELETE CASCADE,
  asset_id uuid NOT NULL REFERENCES app.assets(id) ON DELETE CASCADE,
  suggestion_key text NOT NULL CHECK (suggestion_key ~ '^[0-9a-f]{64}$'),
  suggestion_type text NOT NULL
    CHECK (suggestion_type IN ('failure_propagation', 'fmea_gap', 'review_priority', 'control_gap')),
  title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 160),
  summary text NOT NULL CHECK (char_length(btrim(summary)) BETWEEN 1 AND 1200),
  rationale text NOT NULL CHECK (char_length(btrim(rationale)) BETWEEN 1 AND 3000),
  confidence numeric(5,4) NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  system_instance_ids uuid[] NOT NULL,
  evidence_claim_ids uuid[] NOT NULL DEFAULT '{}',
  evidence_relationship_ids uuid[] NOT NULL DEFAULT '{}',
  failure_propagation_ids uuid[] NOT NULL DEFAULT '{}',
  review_status text NOT NULL DEFAULT 'needs_review'
    CHECK (review_status IN ('needs_review', 'accepted', 'rejected', 'superseded')),
  reviewer_user_account_id uuid REFERENCES app.user_accounts(id) ON DELETE SET NULL,
  reviewer_note text,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (reasoning_job_id, suggestion_key),
  FOREIGN KEY (organization_id, asset_id, reasoning_job_id)
    REFERENCES app.reasoning_jobs(organization_id, asset_id, id) ON DELETE CASCADE,
  CHECK (cardinality(system_instance_ids) > 0),
  CHECK (
    cardinality(evidence_claim_ids)
    + cardinality(evidence_relationship_ids)
    + cardinality(failure_propagation_ids) > 0
  )
);

CREATE INDEX reasoning_suggestions_org_asset_review_idx
  ON app.reasoning_suggestions(organization_id, asset_id, review_status, created_at DESC);
CREATE INDEX reasoning_suggestions_job_idx
  ON app.reasoning_suggestions(reasoning_job_id);

CREATE TRIGGER set_reasoning_suggestions_updated_at
  BEFORE UPDATE ON app.reasoning_suggestions
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

ALTER TABLE app.reasoning_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.reasoning_suggestions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service role all reasoning jobs"
  ON app.reasoning_jobs FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
CREATE POLICY "members can read reasoning jobs"
  ON app.reasoning_jobs FOR SELECT
  USING (organization_id IN (SELECT app.current_organization_ids()));

CREATE POLICY "service role all reasoning suggestions"
  ON app.reasoning_suggestions FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
CREATE POLICY "members can read reasoning suggestions"
  ON app.reasoning_suggestions FOR SELECT
  USING (organization_id IN (SELECT app.current_organization_ids()));

GRANT SELECT ON app.reasoning_jobs, app.reasoning_suggestions TO authenticated;
GRANT ALL ON app.reasoning_jobs, app.reasoning_suggestions TO service_role;
