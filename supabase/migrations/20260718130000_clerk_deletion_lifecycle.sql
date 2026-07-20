-- Preserve product/audit history while making Clerk deletion events fail
-- closed. Personal fields are anonymized by the verified webhook handler.

ALTER TABLE app.user_accounts
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

ALTER TABLE app.user_accounts
  DROP CONSTRAINT IF EXISTS user_accounts_status_check;
ALTER TABLE app.user_accounts
  ADD CONSTRAINT user_accounts_status_check
  CHECK (status IN ('active', 'deleted'));

ALTER TABLE app.organizations
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

ALTER TABLE app.organizations
  DROP CONSTRAINT IF EXISTS organizations_status_check;
ALTER TABLE app.organizations
  ADD CONSTRAINT organizations_status_check
  CHECK (status IN ('active', 'archived'));

ALTER TABLE app.organization_memberships
  ADD COLUMN IF NOT EXISTS removed_at timestamptz;

CREATE INDEX IF NOT EXISTS user_accounts_active_clerk_id_idx
  ON app.user_accounts(clerk_user_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS organizations_active_clerk_id_idx
  ON app.organizations(clerk_organization_id) WHERE status = 'active';
