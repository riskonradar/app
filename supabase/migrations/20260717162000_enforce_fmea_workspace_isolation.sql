-- Scope FMEA data exclusively to the active organization. Personal workspaces
-- are organizations too, so creator identity must never act as a cross-org bypass.

UPDATE app.fmea_analyses AS analysis
SET organization_id = personal_organization.id
FROM app.organizations AS personal_organization
WHERE analysis.organization_id IS NULL
  AND analysis.user_account_id IS NOT NULL
  AND personal_organization.clerk_organization_id IS NULL
  AND personal_organization.created_by_user_account_id = analysis.user_account_id;

UPDATE app.assets AS asset
SET organization_id = personal_organization.id
FROM app.organizations AS personal_organization
WHERE asset.organization_id IS NULL
  AND asset.user_account_id IS NOT NULL
  AND personal_organization.clerk_organization_id IS NULL
  AND personal_organization.created_by_user_account_id = asset.user_account_id;

DROP POLICY IF EXISTS "users can read member assets" ON app.assets;
CREATE POLICY "users can read member assets"
  ON app.assets FOR SELECT
  USING (organization_id IN (SELECT app.current_organization_ids()));

DROP POLICY IF EXISTS "users can read member fmea_analyses" ON app.fmea_analyses;
CREATE POLICY "users can read member fmea_analyses"
  ON app.fmea_analyses FOR SELECT
  USING (organization_id IN (SELECT app.current_organization_ids()));

DROP POLICY IF EXISTS "users can read member fmea_rows" ON app.fmea_rows;
CREATE POLICY "users can read member fmea_rows"
  ON app.fmea_rows FOR SELECT
  USING (
    analysis_id IN (
      SELECT id
      FROM app.fmea_analyses
      WHERE organization_id IN (SELECT app.current_organization_ids())
    )
  );

DROP POLICY IF EXISTS "users can read member fmea_row_evidence" ON app.fmea_row_evidence;
CREATE POLICY "users can read member fmea_row_evidence"
  ON app.fmea_row_evidence FOR SELECT
  USING (
    fmea_row_id IN (
      SELECT row.id
      FROM app.fmea_rows AS row
      JOIN app.fmea_analyses AS analysis ON analysis.id = row.analysis_id
      WHERE analysis.organization_id IN (SELECT app.current_organization_ids())
    )
  );
