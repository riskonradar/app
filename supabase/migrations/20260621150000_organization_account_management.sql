-- Organization/workspace account model for B2B product access.
-- Clerk remains the identity provider; app.* stores product tenancy, billing, and audit state.

CREATE TABLE IF NOT EXISTS app.organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clerk_organization_id text UNIQUE,
  name text NOT NULL,
  slug text UNIQUE,
  plan_key text NOT NULL DEFAULT 'individual'
    CHECK (plan_key IN ('individual', 'team', 'enterprise')),
  billing_status text NOT NULL DEFAULT 'trialing'
    CHECK (billing_status IN ('trialing', 'active', 'past_due', 'cancelled', 'comped')),
  seat_limit integer CHECK (seat_limit IS NULL OR seat_limit > 0),
  domain text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by_user_account_id uuid REFERENCES app.user_accounts(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS organizations_clerk_organization_id_idx
ON app.organizations(clerk_organization_id);

CREATE INDEX IF NOT EXISTS organizations_plan_key_idx
ON app.organizations(plan_key);

CREATE TRIGGER set_organizations_updated_at
BEFORE UPDATE ON app.organizations
FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

ALTER TABLE app.organizations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service role all organizations" ON app.organizations;
CREATE POLICY "service role all organizations"
  ON app.organizations FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE TABLE IF NOT EXISTS app.organization_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES app.organizations(id) ON DELETE CASCADE,
  user_account_id uuid NOT NULL REFERENCES app.user_accounts(id) ON DELETE CASCADE,
  clerk_membership_id text UNIQUE,
  role text NOT NULL DEFAULT 'member'
    CHECK (role IN ('owner', 'admin', 'member', 'viewer')),
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'invited', 'removed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, user_account_id)
);

CREATE INDEX IF NOT EXISTS organization_memberships_org_idx
ON app.organization_memberships(organization_id);

CREATE INDEX IF NOT EXISTS organization_memberships_user_idx
ON app.organization_memberships(user_account_id);

CREATE TRIGGER set_organization_memberships_updated_at
BEFORE UPDATE ON app.organization_memberships
FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

ALTER TABLE app.organization_memberships ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service role all organization_memberships" ON app.organization_memberships;
CREATE POLICY "service role all organization_memberships"
  ON app.organization_memberships FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE TABLE IF NOT EXISTS app.workspace_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES app.organizations(id) ON DELETE CASCADE,
  clerk_invitation_id text UNIQUE,
  email text NOT NULL,
  role text NOT NULL DEFAULT 'member'
    CHECK (role IN ('owner', 'admin', 'member', 'viewer')),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'revoked', 'expired')),
  invited_by_user_account_id uuid REFERENCES app.user_accounts(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS workspace_invitations_org_idx
ON app.workspace_invitations(organization_id);

CREATE INDEX IF NOT EXISTS workspace_invitations_email_idx
ON app.workspace_invitations(email);

CREATE TRIGGER set_workspace_invitations_updated_at
BEFORE UPDATE ON app.workspace_invitations
FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

ALTER TABLE app.workspace_invitations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service role all workspace_invitations" ON app.workspace_invitations;
CREATE POLICY "service role all workspace_invitations"
  ON app.workspace_invitations FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE TABLE IF NOT EXISTS app.subscription_plans (
  key text PRIMARY KEY,
  name text NOT NULL,
  billing_interval text NOT NULL DEFAULT 'monthly'
    CHECK (billing_interval IN ('monthly', 'annual', 'custom')),
  amount_value numeric(12, 2),
  amount_currency text NOT NULL DEFAULT 'EUR',
  included_seats integer,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER set_subscription_plans_updated_at
BEFORE UPDATE ON app.subscription_plans
FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

ALTER TABLE app.subscription_plans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service role all subscription_plans" ON app.subscription_plans;
CREATE POLICY "service role all subscription_plans"
  ON app.subscription_plans FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

INSERT INTO app.subscription_plans (
  key,
  name,
  billing_interval,
  amount_value,
  amount_currency,
  included_seats,
  metadata
)
VALUES
  (
    'individual',
    'Individual',
    'monthly',
    49.00,
    'EUR',
    1,
    '{"positioning":"Single reliability engineer validating traceable FMEA evidence."}'::jsonb
  ),
  (
    'team',
    'Team',
    'monthly',
    399.00,
    'EUR',
    3,
    '{"positioning":"Engineering team workspace with invitations, review ownership, and audit trail."}'::jsonb
  ),
  (
    'enterprise',
    'Enterprise',
    'custom',
    NULL,
    'EUR',
    NULL,
    '{"positioning":"Procurement-led rollout with SSO, domain controls, custom retention, and procurement terms."}'::jsonb
  )
ON CONFLICT (key) DO UPDATE SET
  name = EXCLUDED.name,
  billing_interval = EXCLUDED.billing_interval,
  amount_value = EXCLUDED.amount_value,
  amount_currency = EXCLUDED.amount_currency,
  included_seats = EXCLUDED.included_seats,
  metadata = EXCLUDED.metadata,
  updated_at = now();

CREATE TABLE IF NOT EXISTS app.billing_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES app.organizations(id) ON DELETE SET NULL,
  user_account_id uuid REFERENCES app.user_accounts(id) ON DELETE SET NULL,
  plan_key text NOT NULL REFERENCES app.subscription_plans(key),
  mollie_customer_id text,
  mollie_subscription_id text UNIQUE,
  status text NOT NULL DEFAULT 'pending',
  seats integer NOT NULL DEFAULT 1 CHECK (seats > 0),
  current_period_start timestamptz,
  current_period_end timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (organization_id IS NOT NULL OR user_account_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS billing_subscriptions_org_idx
ON app.billing_subscriptions(organization_id);

CREATE INDEX IF NOT EXISTS billing_subscriptions_user_idx
ON app.billing_subscriptions(user_account_id);

CREATE TRIGGER set_billing_subscriptions_updated_at
BEFORE UPDATE ON app.billing_subscriptions
FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

ALTER TABLE app.billing_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service role all billing_subscriptions" ON app.billing_subscriptions;
CREATE POLICY "service role all billing_subscriptions"
  ON app.billing_subscriptions FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

ALTER TABLE app.billing_customers
ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES app.organizations(id) ON DELETE CASCADE;

ALTER TABLE app.billing_payments
ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES app.organizations(id) ON DELETE SET NULL;

ALTER TABLE app.billing_payments
ADD COLUMN IF NOT EXISTS plan_key text REFERENCES app.subscription_plans(key);

ALTER TABLE app.billing_payments
ADD COLUMN IF NOT EXISTS seats integer NOT NULL DEFAULT 1 CHECK (seats > 0);

CREATE INDEX IF NOT EXISTS billing_customers_organization_id_idx
ON app.billing_customers(organization_id);

CREATE INDEX IF NOT EXISTS billing_payments_organization_id_idx
ON app.billing_payments(organization_id);

ALTER TABLE app.assets
ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES app.organizations(id) ON DELETE SET NULL;

ALTER TABLE app.assets
ADD COLUMN IF NOT EXISTS created_by_user_account_id uuid REFERENCES app.user_accounts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS assets_organization_id_idx
ON app.assets(organization_id);

ALTER TABLE app.fmea_analyses
ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES app.organizations(id) ON DELETE SET NULL;

ALTER TABLE app.fmea_analyses
ADD COLUMN IF NOT EXISTS created_by_user_account_id uuid REFERENCES app.user_accounts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS fmea_analyses_organization_id_idx
ON app.fmea_analyses(organization_id);

ALTER TABLE app.fmea_review_events
ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES app.organizations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS fmea_review_events_organization_id_idx
ON app.fmea_review_events(organization_id);

CREATE TABLE IF NOT EXISTS app.evidence_claim_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES app.organizations(id) ON DELETE CASCADE,
  evidence_claim_id uuid NOT NULL REFERENCES knowledge.evidence_claims(id) ON DELETE CASCADE,
  reviewer_user_account_id uuid REFERENCES app.user_accounts(id) ON DELETE SET NULL,
  review_status text NOT NULL DEFAULT 'needs_review'
    CHECK (review_status IN ('needs_review', 'accepted', 'edited', 'rejected', 'superseded')),
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, evidence_claim_id)
);

CREATE INDEX IF NOT EXISTS evidence_claim_reviews_org_idx
ON app.evidence_claim_reviews(organization_id);

CREATE INDEX IF NOT EXISTS evidence_claim_reviews_claim_idx
ON app.evidence_claim_reviews(evidence_claim_id);

CREATE TRIGGER set_evidence_claim_reviews_updated_at
BEFORE UPDATE ON app.evidence_claim_reviews
FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

ALTER TABLE app.evidence_claim_reviews ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service role all evidence_claim_reviews" ON app.evidence_claim_reviews;
CREATE POLICY "service role all evidence_claim_reviews"
  ON app.evidence_claim_reviews FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE TABLE IF NOT EXISTS app.account_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES app.organizations(id) ON DELETE SET NULL,
  user_account_id uuid REFERENCES app.user_accounts(id) ON DELETE SET NULL,
  actor_clerk_user_id text,
  event_type text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS account_audit_events_org_idx
ON app.account_audit_events(organization_id);

CREATE INDEX IF NOT EXISTS account_audit_events_user_idx
ON app.account_audit_events(user_account_id);

ALTER TABLE app.account_audit_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service role all account_audit_events" ON app.account_audit_events;
CREATE POLICY "service role all account_audit_events"
  ON app.account_audit_events FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
