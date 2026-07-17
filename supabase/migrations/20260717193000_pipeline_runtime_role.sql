-- Dedicated runtime identity for discovery, classification, full-text ingestion,
-- taxonomy linking, and optional aggregate reasoning. The role is deliberately
-- created without LOGIN; production supplies a generated password out-of-band.

DO $role$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'riskonradar_pipeline'
  ) THEN
    CREATE ROLE riskonradar_pipeline
      NOLOGIN;
  END IF;
END
$role$;

DO $role_safety$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_roles
    WHERE rolname = 'riskonradar_pipeline'
      AND (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)
  ) THEN
    RAISE EXCEPTION 'riskonradar_pipeline has unsafe role attributes';
  END IF;
END
$role_safety$;

ALTER ROLE riskonradar_pipeline
  SET statement_timeout = '5min';
ALTER ROLE riskonradar_pipeline
  SET idle_in_transaction_session_timeout = '1min';

GRANT CONNECT ON DATABASE postgres TO riskonradar_pipeline;
GRANT USAGE ON SCHEMA app, knowledge, papers_raw, public
  TO riskonradar_pipeline;

GRANT SELECT, INSERT, UPDATE ON TABLE
  papers_raw.discovery_runs,
  papers_raw.paper_candidates
TO riskonradar_pipeline;

GRANT SELECT, INSERT ON TABLE
  papers_raw.paper_full_texts
TO riskonradar_pipeline;

GRANT SELECT, INSERT, UPDATE ON TABLE
  knowledge.classification_jobs
TO riskonradar_pipeline;

GRANT SELECT, INSERT, UPDATE ON TABLE
  knowledge.evidence_claims
TO riskonradar_pipeline;

GRANT SELECT, INSERT ON TABLE
  knowledge.evidence_spans,
  knowledge.claim_relationships
TO riskonradar_pipeline;

GRANT SELECT ON TABLE
  knowledge.components,
  knowledge.claim_component_links,
  knowledge.failure_modes,
  knowledge.claim_failure_mode_links,
  knowledge.analysis_methods,
  knowledge.claim_analysis_method_links,
  knowledge.applications,
  knowledge.claim_application_links,
  public.easa_ads
TO riskonradar_pipeline;

GRANT SELECT ON TABLE
  app.assets,
  app.asset_component_instances,
  app.asset_dependencies,
  app.asset_failure_propagations,
  app.evidence_claim_reviews
TO riskonradar_pipeline;

GRANT SELECT, INSERT, UPDATE ON TABLE
  app.reasoning_jobs,
  app.reasoning_suggestions
TO riskonradar_pipeline;

-- Direct Postgres workers do not carry an end-user JWT. Grant exactly the RLS
-- visibility corresponding to the table privileges above instead of using the
-- managed database's superuser-only row-security bypass attribute.
DO $policies$
DECLARE
  v_table regclass;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'papers_raw.discovery_runs'::regclass,
    'papers_raw.paper_candidates'::regclass,
    'papers_raw.paper_full_texts'::regclass,
    'knowledge.classification_jobs'::regclass,
    'knowledge.evidence_claims'::regclass,
    'knowledge.evidence_spans'::regclass,
    'knowledge.claim_relationships'::regclass,
    'knowledge.components'::regclass,
    'knowledge.claim_component_links'::regclass,
    'knowledge.failure_modes'::regclass,
    'knowledge.claim_failure_mode_links'::regclass,
    'knowledge.analysis_methods'::regclass,
    'knowledge.claim_analysis_method_links'::regclass,
    'knowledge.applications'::regclass,
    'knowledge.claim_application_links'::regclass,
    'public.easa_ads'::regclass,
    'app.assets'::regclass,
    'app.asset_component_instances'::regclass,
    'app.asset_dependencies'::regclass,
    'app.asset_failure_propagations'::regclass,
    'app.evidence_claim_reviews'::regclass,
    'app.reasoning_jobs'::regclass,
    'app.reasoning_suggestions'::regclass
  ]
  LOOP
    EXECUTE pg_catalog.format(
      'CREATE POLICY "pipeline runtime access" ON %s FOR ALL TO riskonradar_pipeline USING (true) WITH CHECK (true)',
      v_table
    );
  END LOOP;
END
$policies$;

GRANT EXECUTE ON FUNCTION knowledge.link_component_claims(boolean)
  TO riskonradar_pipeline;
GRANT EXECUTE ON FUNCTION knowledge.link_failure_mode_claims(boolean)
  TO riskonradar_pipeline;
GRANT EXECUTE ON FUNCTION knowledge.link_analysis_method_claims(boolean)
  TO riskonradar_pipeline;
GRANT EXECUTE ON FUNCTION knowledge.link_application_claims(boolean)
  TO riskonradar_pipeline;

REVOKE CREATE ON SCHEMA app, knowledge, papers_raw, public
  FROM riskonradar_pipeline;

COMMENT ON ROLE riskonradar_pipeline IS
  'Non-owner runtime role for Risk on Radar background pipeline services; LOGIN/password are configured out-of-band.';
