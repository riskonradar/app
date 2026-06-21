-- Deployment blocker fixes for app schema, current classifier contracts, and webhook-backed billing.

ALTER TABLE knowledge.evidence_claims
DROP CONSTRAINT IF EXISTS evidence_claims_claim_type_check;

ALTER TABLE knowledge.evidence_claims
ADD CONSTRAINT evidence_claims_claim_type_check CHECK (
  claim_type IN (
    'component',
    'failure_mode',
    'cause',
    'effect',
    'control',
    'corrective_action',
    'analysis_method',
    'application',
    'operating_context',
    'detection_method',
    'maintenance_action',
    'material',
    'environment'
  )
);

ALTER TABLE knowledge.claim_relationships
DROP CONSTRAINT IF EXISTS claim_relationships_relationship_type_check;

ALTER TABLE knowledge.claim_relationships
ADD CONSTRAINT claim_relationships_relationship_type_check CHECK (
  relationship_type IN (
    'has_failure_mode',
    'caused_by',
    'has_effect',
    'mitigated_by',
    'corrected_by',
    'detected_by',
    'analysed_by',
    'has_context'
  )
);

CREATE TABLE IF NOT EXISTS public.easa_ads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ad_number text NOT NULL UNIQUE,
  title text,
  summary_text text,
  affected_products text,
  required_actions text,
  compliance_time text,
  approval_holder text,
  engine_family text,
  engine_models text[] NOT NULL DEFAULT '{}',
  ata_chapter text,
  issue_date date,
  effective_date date,
  source_category text,
  keyword text,
  ad_url text,
  primary_pdf_url text,
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS easa_ads_ad_number_idx
ON public.easa_ads(ad_number);

CREATE INDEX IF NOT EXISTS easa_ads_keyword_idx
ON public.easa_ads(keyword);

DROP TRIGGER IF EXISTS set_easa_ads_updated_at ON public.easa_ads;
CREATE TRIGGER set_easa_ads_updated_at
BEFORE UPDATE ON public.easa_ads
FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

ALTER TABLE public.easa_ads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "open read easa_ads" ON public.easa_ads;
CREATE POLICY "open read easa_ads"
  ON public.easa_ads FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "service role all easa_ads" ON public.easa_ads;
CREATE POLICY "service role all easa_ads"
  ON public.easa_ads FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "service role all fmea_row_evidence" ON app.fmea_row_evidence;
CREATE POLICY "service role all fmea_row_evidence"
  ON app.fmea_row_evidence FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE OR REPLACE FUNCTION app.current_user_account_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = app, public
AS $$
  SELECT id
  FROM app.user_accounts
  WHERE clerk_user_id = auth.jwt() ->> 'sub'
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION app.current_organization_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = app, public
AS $$
  SELECT organization_id
  FROM app.organization_memberships
  WHERE user_account_id = app.current_user_account_id()
    AND status = 'active';
$$;

DROP POLICY IF EXISTS "users can read own user_account" ON app.user_accounts;
CREATE POLICY "users can read own user_account"
  ON app.user_accounts FOR SELECT
  USING (id = app.current_user_account_id());

DROP POLICY IF EXISTS "users can read member organizations" ON app.organizations;
CREATE POLICY "users can read member organizations"
  ON app.organizations FOR SELECT
  USING (id IN (SELECT app.current_organization_ids()));

DROP POLICY IF EXISTS "users can read member organization_memberships" ON app.organization_memberships;
CREATE POLICY "users can read member organization_memberships"
  ON app.organization_memberships FOR SELECT
  USING (organization_id IN (SELECT app.current_organization_ids()));

DROP POLICY IF EXISTS "users can read member workspace_invitations" ON app.workspace_invitations;
CREATE POLICY "users can read member workspace_invitations"
  ON app.workspace_invitations FOR SELECT
  USING (organization_id IN (SELECT app.current_organization_ids()));

DROP POLICY IF EXISTS "authenticated users can read subscription_plans" ON app.subscription_plans;
CREATE POLICY "authenticated users can read subscription_plans"
  ON app.subscription_plans FOR SELECT
  USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "users can read member billing_subscriptions" ON app.billing_subscriptions;
CREATE POLICY "users can read member billing_subscriptions"
  ON app.billing_subscriptions FOR SELECT
  USING (
    user_account_id = app.current_user_account_id()
    OR organization_id IN (SELECT app.current_organization_ids())
  );

DROP POLICY IF EXISTS "users can read member billing_customers" ON app.billing_customers;
CREATE POLICY "users can read member billing_customers"
  ON app.billing_customers FOR SELECT
  USING (
    user_account_id = app.current_user_account_id()
    OR organization_id IN (SELECT app.current_organization_ids())
  );

DROP POLICY IF EXISTS "users can read member billing_payments" ON app.billing_payments;
CREATE POLICY "users can read member billing_payments"
  ON app.billing_payments FOR SELECT
  USING (
    user_account_id = app.current_user_account_id()
    OR organization_id IN (SELECT app.current_organization_ids())
  );

DROP POLICY IF EXISTS "users can read member assets" ON app.assets;
CREATE POLICY "users can read member assets"
  ON app.assets FOR SELECT
  USING (
    user_account_id = app.current_user_account_id()
    OR organization_id IN (SELECT app.current_organization_ids())
  );

DROP POLICY IF EXISTS "users can read member fmea_analyses" ON app.fmea_analyses;
CREATE POLICY "users can read member fmea_analyses"
  ON app.fmea_analyses FOR SELECT
  USING (
    user_account_id = app.current_user_account_id()
    OR organization_id IN (SELECT app.current_organization_ids())
  );

DROP POLICY IF EXISTS "users can read member fmea_rows" ON app.fmea_rows;
CREATE POLICY "users can read member fmea_rows"
  ON app.fmea_rows FOR SELECT
  USING (
    analysis_id IN (
      SELECT id
      FROM app.fmea_analyses
      WHERE user_account_id = app.current_user_account_id()
         OR organization_id IN (SELECT app.current_organization_ids())
    )
  );

DROP POLICY IF EXISTS "users can read member fmea_row_evidence" ON app.fmea_row_evidence;
CREATE POLICY "users can read member fmea_row_evidence"
  ON app.fmea_row_evidence FOR SELECT
  USING (
    fmea_row_id IN (
      SELECT fr.id
      FROM app.fmea_rows fr
      JOIN app.fmea_analyses fa ON fa.id = fr.analysis_id
      WHERE fa.user_account_id = app.current_user_account_id()
         OR fa.organization_id IN (SELECT app.current_organization_ids())
    )
  );

DROP POLICY IF EXISTS "users can read member fmea_review_events" ON app.fmea_review_events;
CREATE POLICY "users can read member fmea_review_events"
  ON app.fmea_review_events FOR SELECT
  USING (organization_id IN (SELECT app.current_organization_ids()));

DROP POLICY IF EXISTS "users can read member evidence_claim_reviews" ON app.evidence_claim_reviews;
CREATE POLICY "users can read member evidence_claim_reviews"
  ON app.evidence_claim_reviews FOR SELECT
  USING (organization_id IN (SELECT app.current_organization_ids()));

DROP POLICY IF EXISTS "users can read member account_audit_events" ON app.account_audit_events;
CREATE POLICY "users can read member account_audit_events"
  ON app.account_audit_events FOR SELECT
  USING (
    user_account_id = app.current_user_account_id()
    OR organization_id IN (SELECT app.current_organization_ids())
  );
