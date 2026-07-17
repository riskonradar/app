-- Extend the shared-taxonomy pattern only where the extracted corpus and
-- classifier vocabulary show stable, reusable labels: analysis methods and
-- applications. Other previously un-taxonomized fields remain free text.

-- ============================================================
-- Taxonomy and claim-link tables
-- ============================================================

CREATE TABLE IF NOT EXISTS knowledge.analysis_methods (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text        NOT NULL UNIQUE,
  slug        text        NOT NULL UNIQUE
              CONSTRAINT analysis_methods_slug_format CHECK (slug ~ '^[a-z0-9][a-z0-9\-]*$'),
  parent_id   uuid        REFERENCES knowledge.analysis_methods(id) ON DELETE RESTRICT,
  path        text        NOT NULL UNIQUE,
  depth       smallint    NOT NULL DEFAULT 0 CHECK (depth BETWEEN 0 AND 5),
  aliases     text[]      NOT NULL DEFAULT '{}',
  description text,
  is_leaf     boolean     NOT NULL DEFAULT true,
  is_active   boolean     NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER set_analysis_methods_updated_at
  BEFORE UPDATE ON knowledge.analysis_methods
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

CREATE INDEX analysis_methods_path_idx ON knowledge.analysis_methods (path text_pattern_ops);
CREATE INDEX analysis_methods_name_trgm_idx ON knowledge.analysis_methods USING gin (name extensions.gin_trgm_ops);
CREATE INDEX analysis_methods_parent_id_idx ON knowledge.analysis_methods (parent_id);

ALTER TABLE knowledge.analysis_methods ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated read analysis_methods"
  ON knowledge.analysis_methods FOR SELECT
  USING (auth.role() IN ('authenticated', 'service_role'));

CREATE TABLE IF NOT EXISTS knowledge.claim_analysis_method_links (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  evidence_claim_id  uuid        NOT NULL REFERENCES knowledge.evidence_claims(id) ON DELETE CASCADE,
  analysis_method_id uuid        NOT NULL REFERENCES knowledge.analysis_methods(id) ON DELETE RESTRICT,
  link_method        text        NOT NULL DEFAULT 'auto_exact'
                     CHECK (link_method IN ('auto_exact','auto_fuzzy','auto_inferred','manual')),
  match_score        numeric(5,4),
  confidence         numeric(5,4) NOT NULL DEFAULT 0.0,
  review_status      text        NOT NULL DEFAULT 'needs_review'
                     CHECK (review_status IN ('needs_review','accepted','rejected')),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (evidence_claim_id, analysis_method_id)
);

CREATE TRIGGER set_claim_analysis_method_links_updated_at
  BEFORE UPDATE ON knowledge.claim_analysis_method_links
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

CREATE INDEX claim_analysis_method_links_claim_idx
  ON knowledge.claim_analysis_method_links (evidence_claim_id);
CREATE INDEX claim_analysis_method_links_method_idx
  ON knowledge.claim_analysis_method_links (analysis_method_id);

ALTER TABLE knowledge.claim_analysis_method_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated read claim_analysis_method_links"
  ON knowledge.claim_analysis_method_links FOR SELECT
  USING (auth.role() IN ('authenticated', 'service_role'));

CREATE TABLE IF NOT EXISTS knowledge.applications (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text        NOT NULL UNIQUE,
  slug        text        NOT NULL UNIQUE
              CONSTRAINT applications_slug_format CHECK (slug ~ '^[a-z0-9][a-z0-9\-]*$'),
  parent_id   uuid        REFERENCES knowledge.applications(id) ON DELETE RESTRICT,
  path        text        NOT NULL UNIQUE,
  depth       smallint    NOT NULL DEFAULT 0 CHECK (depth BETWEEN 0 AND 5),
  aliases     text[]      NOT NULL DEFAULT '{}',
  description text,
  is_leaf     boolean     NOT NULL DEFAULT true,
  is_active   boolean     NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER set_applications_updated_at
  BEFORE UPDATE ON knowledge.applications
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

CREATE INDEX applications_path_idx ON knowledge.applications (path text_pattern_ops);
CREATE INDEX applications_name_trgm_idx ON knowledge.applications USING gin (name extensions.gin_trgm_ops);
CREATE INDEX applications_parent_id_idx ON knowledge.applications (parent_id);

ALTER TABLE knowledge.applications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated read applications"
  ON knowledge.applications FOR SELECT
  USING (auth.role() IN ('authenticated', 'service_role'));

CREATE TABLE IF NOT EXISTS knowledge.claim_application_links (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  evidence_claim_id uuid        NOT NULL REFERENCES knowledge.evidence_claims(id) ON DELETE CASCADE,
  application_id    uuid        NOT NULL REFERENCES knowledge.applications(id) ON DELETE RESTRICT,
  link_method       text        NOT NULL DEFAULT 'auto_exact'
                    CHECK (link_method IN ('auto_exact','auto_fuzzy','auto_inferred','manual')),
  match_score       numeric(5,4),
  confidence        numeric(5,4) NOT NULL DEFAULT 0.0,
  review_status     text        NOT NULL DEFAULT 'needs_review'
                    CHECK (review_status IN ('needs_review','accepted','rejected')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (evidence_claim_id, application_id)
);

CREATE TRIGGER set_claim_application_links_updated_at
  BEFORE UPDATE ON knowledge.claim_application_links
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

CREATE INDEX claim_application_links_claim_idx
  ON knowledge.claim_application_links (evidence_claim_id);
CREATE INDEX claim_application_links_application_idx
  ON knowledge.claim_application_links (application_id);

ALTER TABLE knowledge.claim_application_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated read claim_application_links"
  ON knowledge.claim_application_links FOR SELECT
  USING (auth.role() IN ('authenticated', 'service_role'));

-- Seed stable engineering vocabularies (parents before children)
-- ============================================================

INSERT INTO knowledge.analysis_methods
  (name, slug, parent_id, path, depth, aliases, description, is_leaf)
VALUES
  ('Computational analysis', 'computational-analysis', null, 'computational-analysis', 0,
   ARRAY[]::text[], 'Numerical and computational investigation methods', false),
  ('Experimental analysis', 'experimental-analysis', null, 'experimental-analysis', 0,
   ARRAY[]::text[], 'Physical tests and laboratory experiments', false),
  ('Microscopy and fractography', 'microscopy-fractography', null, 'microscopy-fractography', 0,
   ARRAY[]::text[], 'Surface, fracture-surface and microstructure examination', false),
  ('Materials characterization', 'materials-characterization', null, 'materials-characterization', 0,
   ARRAY[]::text[], 'Methods that identify material composition and structure', false),
  ('Analytical modeling', 'analytical-modeling', null, 'analytical-modeling', 0,
   ARRAY['analytical model','analytical solution','mathematical model'], 'Closed-form and theory-based engineering analysis', false),
  ('Data-driven analysis', 'data-driven-analysis', null, 'data-driven-analysis', 0,
   ARRAY[]::text[], 'Statistical and learned analysis methods', false);

INSERT INTO knowledge.analysis_methods
  (name, slug, parent_id, path, depth, aliases, is_leaf)
VALUES
  ('Finite element analysis', 'finite-element-analysis',
   (SELECT id FROM knowledge.analysis_methods WHERE slug='computational-analysis'),
   'computational-analysis/finite-element-analysis', 1,
   ARRAY['finite element method','finite element','fea','fem'], true),
  ('Computational fluid dynamics', 'computational-fluid-dynamics',
   (SELECT id FROM knowledge.analysis_methods WHERE slug='computational-analysis'),
   'computational-analysis/computational-fluid-dynamics', 1,
   ARRAY['cfd'], true),
  ('Simulation', 'simulation',
   (SELECT id FROM knowledge.analysis_methods WHERE slug='computational-analysis'),
   'computational-analysis/simulation', 1,
   ARRAY['numerical simulation','computational simulation'], true),
  ('Probabilistic analysis', 'probabilistic-analysis',
   (SELECT id FROM knowledge.analysis_methods WHERE slug='computational-analysis'),
   'computational-analysis/probabilistic-analysis', 1,
   ARRAY['probabilistic fatigue assessment','probabilistic fatigue','reliability analysis','monte carlo','monte carlo simulation'], true),
  ('Experimental testing', 'experimental-testing',
   (SELECT id FROM knowledge.analysis_methods WHERE slug='experimental-analysis'),
   'experimental-analysis/experimental-testing', 1,
   ARRAY['experimental','experiment','laboratory test','bench test'], true),
  ('Fatigue testing', 'fatigue-testing',
   (SELECT id FROM knowledge.analysis_methods WHERE slug='experimental-analysis'),
   'experimental-analysis/fatigue-testing', 1,
   ARRAY['fatigue test'], true),
  ('Scanning electron microscopy', 'scanning-electron-microscopy',
   (SELECT id FROM knowledge.analysis_methods WHERE slug='microscopy-fractography'),
   'microscopy-fractography/scanning-electron-microscopy', 1,
   ARRAY['sem','electron microscopy'], true),
  ('Optical microscopy', 'optical-microscopy',
   (SELECT id FROM knowledge.analysis_methods WHERE slug='microscopy-fractography'),
   'microscopy-fractography/optical-microscopy', 1,
   ARRAY['light microscopy'], true),
  ('Fractography', 'fractography',
   (SELECT id FROM knowledge.analysis_methods WHERE slug='microscopy-fractography'),
   'microscopy-fractography/fractography', 1,
   ARRAY['fractographic analysis','fracture surface analysis'], true),
  ('X-ray diffraction', 'x-ray-diffraction',
   (SELECT id FROM knowledge.analysis_methods WHERE slug='materials-characterization'),
   'materials-characterization/x-ray-diffraction', 1,
   ARRAY['xrd','x-ray analysis'], true),
  ('Energy-dispersive spectroscopy', 'energy-dispersive-spectroscopy',
   (SELECT id FROM knowledge.analysis_methods WHERE slug='materials-characterization'),
   'materials-characterization/energy-dispersive-spectroscopy', 1,
   ARRAY['eds','edx','energy dispersive x-ray spectroscopy','energy-dispersive x-ray spectroscopy'], true),
  ('Metallography', 'metallography',
   (SELECT id FROM knowledge.analysis_methods WHERE slug='materials-characterization'),
   'materials-characterization/metallography', 1,
   ARRAY['metallographic analysis'], true),
  ('Fracture mechanics', 'fracture-mechanics',
   (SELECT id FROM knowledge.analysis_methods WHERE slug='analytical-modeling'),
   'analytical-modeling/fracture-mechanics', 1,
   ARRAY['linear elastic fracture mechanics','lefm','stress intensity factor analysis'], true),
  ('Machine learning', 'machine-learning',
   (SELECT id FROM knowledge.analysis_methods WHERE slug='data-driven-analysis'),
   'data-driven-analysis/machine-learning', 1,
   ARRAY['ml','deep learning','neural network','random forest','convolutional neural network'], true),
  ('Signal processing', 'signal-processing',
   (SELECT id FROM knowledge.analysis_methods WHERE slug='data-driven-analysis'),
   'data-driven-analysis/signal-processing', 1,
   ARRAY['signal analysis','frequency analysis','spectral analysis'], true);

INSERT INTO knowledge.applications
  (name, slug, parent_id, path, depth, aliases, description, is_leaf)
VALUES
  ('Transportation', 'transportation', null, 'transportation', 0,
   ARRAY[]::text[], 'Mobile systems that carry people or goods', false),
  ('Energy', 'energy', null, 'energy', 0,
   ARRAY[]::text[], 'Energy production, conversion and distribution', false),
  ('Industrial and process', 'industrial-process', null, 'industrial-process', 0,
   ARRAY['industrial'], 'Manufacturing, extraction and process industries', false),
  ('Built infrastructure', 'built-infrastructure', null, 'built-infrastructure', 0,
   ARRAY['infrastructure'], 'Civil and structural infrastructure', false);

INSERT INTO knowledge.applications
  (name, slug, parent_id, path, depth, aliases, is_leaf)
VALUES
  ('Aviation', 'aviation',
   (SELECT id FROM knowledge.applications WHERE slug='transportation'),
   'transportation/aviation', 1,
   ARRAY['aircraft','aerospace','aeronautics','turbofan','turboprop','turboshaft','aeroengine','aero-engine'], true),
  ('Automotive', 'automotive',
   (SELECT id FROM knowledge.applications WHERE slug='transportation'),
   'transportation/automotive', 1,
   ARRAY['vehicle','car','powertrain','drivetrain'], true),
  ('Rail', 'rail',
   (SELECT id FROM knowledge.applications WHERE slug='transportation'),
   'transportation/rail', 1,
   ARRAY['railway','rail transport','train'], true),
  ('Marine', 'marine',
   (SELECT id FROM knowledge.applications WHERE slug='transportation'),
   'transportation/marine', 1,
   ARRAY['maritime','ship','vessel','marine propulsion'], true),
  ('Wind energy', 'wind-energy',
   (SELECT id FROM knowledge.applications WHERE slug='energy'),
   'energy/wind-energy', 1,
   ARRAY['wind turbine','wind power','offshore wind'], true),
  ('Oil and gas', 'oil-gas',
   (SELECT id FROM knowledge.applications WHERE slug='energy'),
   'energy/oil-gas', 1,
   ARRAY['oil & gas','petroleum','pipeline','offshore platform','subsea'], true),
  ('Nuclear energy', 'nuclear-energy',
   (SELECT id FROM knowledge.applications WHERE slug='energy'),
   'energy/nuclear-energy', 1,
   ARRAY['nuclear','nuclear power','nuclear power plant','reactor'], true),
  ('Power generation', 'power-generation',
   (SELECT id FROM knowledge.applications WHERE slug='energy'),
   'energy/power-generation', 1,
   ARRAY['power plant','gas turbine','steam turbine'], true),
  ('Solar energy', 'solar-energy',
   (SELECT id FROM knowledge.applications WHERE slug='energy'),
   'energy/solar-energy', 1,
   ARRAY['solar power','photovoltaic','pv'], true),
  ('Manufacturing', 'manufacturing',
   (SELECT id FROM knowledge.applications WHERE slug='industrial-process'),
   'industrial-process/manufacturing', 1,
   ARRAY['production engineering'], true),
  ('Mining', 'mining',
   (SELECT id FROM knowledge.applications WHERE slug='industrial-process'),
   'industrial-process/mining', 1,
   ARRAY['mine','excavator','drilling rig'], true),
  ('Chemical processing', 'chemical-processing',
   (SELECT id FROM knowledge.applications WHERE slug='industrial-process'),
   'industrial-process/chemical-processing', 1,
   ARRAY['chemical process','process plant','petrochemical'], true),
  ('Civil infrastructure', 'civil-infrastructure',
   (SELECT id FROM knowledge.applications WHERE slug='built-infrastructure'),
   'built-infrastructure/civil-infrastructure', 1,
   ARRAY['civil engineering','bridge','building','structural engineering'], true);

CREATE OR REPLACE FUNCTION knowledge.link_analysis_method_claims(
  p_dry_run boolean DEFAULT false
)
RETURNS TABLE (claim_id uuid, normalized_value text, matched_slug text, match_method text, match_score numeric)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  v_threshold numeric := 0.45;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'link_analysis_method_claims requires service_role';
  END IF;

  DROP TABLE IF EXISTS _analysis_method_matches;
  CREATE TEMP TABLE _analysis_method_matches AS
  WITH unlinked AS (
    SELECT ec.id, ec.normalized_value AS label
    FROM knowledge.evidence_claims ec
    WHERE ec.claim_type = 'analysis_method'
      AND ec.normalized_value IS NOT NULL
      AND ec.review_status NOT IN ('rejected', 'superseded')
      AND NOT EXISTS (
        SELECT 1 FROM knowledge.claim_analysis_method_links l
        WHERE l.evidence_claim_id = ec.id AND l.review_status != 'rejected'
      )
  ),
  exact_matches AS (
    SELECT u.id AS claim_id, u.label, am.id AS node_id, am.slug,
           'auto_exact'::text AS method, 1.0::numeric AS score
    FROM unlinked u
    JOIN knowledge.analysis_methods am ON am.is_active = true
      AND (
        lower(am.name) = lower(u.label)
        OR lower(u.label) = ANY(SELECT lower(a) FROM unnest(am.aliases) a)
      )
  ),
  fuzzy_matches AS (
    SELECT DISTINCT ON (u.id)
      u.id AS claim_id, u.label, am.id AS node_id, am.slug,
      'auto_fuzzy'::text AS method,
      extensions.similarity(lower(u.label), lower(am.name))::numeric AS score
    FROM unlinked u
    JOIN knowledge.analysis_methods am ON am.is_active = true
      AND extensions.similarity(lower(u.label), lower(am.name)) >= v_threshold
    WHERE u.id NOT IN (SELECT em.claim_id FROM exact_matches em)
    ORDER BY u.id, extensions.similarity(lower(u.label), lower(am.name)) DESC
  )
  SELECT * FROM exact_matches UNION ALL SELECT * FROM fuzzy_matches;

  IF NOT p_dry_run THEN
    INSERT INTO knowledge.claim_analysis_method_links
      (evidence_claim_id, analysis_method_id, link_method, match_score, confidence, review_status)
    SELECT m.claim_id, m.node_id, m.method, m.score,
           CASE WHEN m.method = 'auto_exact' THEN 0.90 ELSE m.score * 0.70 END,
           'needs_review'
    FROM _analysis_method_matches m
    ON CONFLICT (evidence_claim_id, analysis_method_id) DO UPDATE
      SET match_score = EXCLUDED.match_score, confidence = EXCLUDED.confidence, updated_at = now();
  END IF;

  RETURN QUERY
    SELECT m.claim_id, m.label, m.slug, m.method, m.score
    FROM _analysis_method_matches m;
  DROP TABLE _analysis_method_matches;
END;
$$;

CREATE OR REPLACE FUNCTION knowledge.link_application_claims(
  p_dry_run boolean DEFAULT false
)
RETURNS TABLE (claim_id uuid, normalized_value text, matched_slug text, match_method text, match_score numeric)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  v_threshold numeric := 0.45;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'link_application_claims requires service_role';
  END IF;

  DROP TABLE IF EXISTS _application_matches;
  CREATE TEMP TABLE _application_matches AS
  WITH unlinked AS (
    SELECT ec.id, ec.normalized_value AS label
    FROM knowledge.evidence_claims ec
    WHERE ec.claim_type = 'application'
      AND ec.normalized_value IS NOT NULL
      AND ec.review_status NOT IN ('rejected', 'superseded')
      AND NOT EXISTS (
        SELECT 1 FROM knowledge.claim_application_links l
        WHERE l.evidence_claim_id = ec.id AND l.review_status != 'rejected'
      )
  ),
  exact_matches AS (
    SELECT u.id AS claim_id, u.label, a.id AS node_id, a.slug,
           'auto_exact'::text AS method, 1.0::numeric AS score
    FROM unlinked u
    JOIN knowledge.applications a ON a.is_active = true
      AND (
        lower(a.name) = lower(u.label)
        OR lower(u.label) = ANY(SELECT lower(a_alias) FROM unnest(a.aliases) a_alias)
      )
  ),
  fuzzy_matches AS (
    SELECT DISTINCT ON (u.id)
      u.id AS claim_id, u.label, a.id AS node_id, a.slug,
      'auto_fuzzy'::text AS method,
      extensions.similarity(lower(u.label), lower(a.name))::numeric AS score
    FROM unlinked u
    JOIN knowledge.applications a ON a.is_active = true
      AND extensions.similarity(lower(u.label), lower(a.name)) >= v_threshold
    WHERE u.id NOT IN (SELECT em.claim_id FROM exact_matches em)
    ORDER BY u.id, extensions.similarity(lower(u.label), lower(a.name)) DESC
  )
  SELECT * FROM exact_matches UNION ALL SELECT * FROM fuzzy_matches;

  IF NOT p_dry_run THEN
    INSERT INTO knowledge.claim_application_links
      (evidence_claim_id, application_id, link_method, match_score, confidence, review_status)
    SELECT m.claim_id, m.node_id, m.method, m.score,
           CASE WHEN m.method = 'auto_exact' THEN 0.90 ELSE m.score * 0.70 END,
           'needs_review'
    FROM _application_matches m
    ON CONFLICT (evidence_claim_id, application_id) DO UPDATE
      SET match_score = EXCLUDED.match_score, confidence = EXCLUDED.confidence, updated_at = now();
  END IF;

  RETURN QUERY
    SELECT m.claim_id, m.label, m.slug, m.method, m.score
    FROM _application_matches m;
  DROP TABLE _application_matches;
END;
$$;

REVOKE EXECUTE ON FUNCTION knowledge.link_analysis_method_claims(boolean)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION knowledge.link_application_claims(boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION knowledge.link_analysis_method_claims(boolean) TO service_role;
GRANT EXECUTE ON FUNCTION knowledge.link_application_claims(boolean) TO service_role;

-- ============================================================
-- Unmatched labels for taxonomy-backed claim types only
-- ============================================================

CREATE OR REPLACE VIEW knowledge.taxonomy_inbox AS
SELECT
  ec.claim_type,
  lower(coalesce(ec.normalized_value, ec.raw_value)) AS label,
  count(*)                                           AS claim_count,
  count(DISTINCT ec.paper_candidate_id)              AS paper_count,
  max(ec.created_at)                                 AS last_seen_at
FROM knowledge.evidence_claims ec
WHERE ec.review_status NOT IN ('rejected', 'superseded')
  AND coalesce(ec.normalized_value, ec.raw_value) IS NOT NULL
  AND (
    (ec.claim_type = 'component' AND NOT EXISTS (
      SELECT 1 FROM knowledge.claim_component_links l
      WHERE l.evidence_claim_id = ec.id AND l.review_status != 'rejected'))
    OR
    (ec.claim_type = 'failure_mode' AND NOT EXISTS (
      SELECT 1 FROM knowledge.claim_failure_mode_links l
      WHERE l.evidence_claim_id = ec.id AND l.review_status != 'rejected'))
    OR
    (ec.claim_type = 'analysis_method' AND NOT EXISTS (
      SELECT 1 FROM knowledge.claim_analysis_method_links l
      WHERE l.evidence_claim_id = ec.id AND l.review_status != 'rejected'))
    OR
    (ec.claim_type = 'application' AND NOT EXISTS (
      SELECT 1 FROM knowledge.claim_application_links l
      WHERE l.evidence_claim_id = ec.id AND l.review_status != 'rejected'))
  )
GROUP BY ec.claim_type, lower(coalesce(ec.normalized_value, ec.raw_value));

CREATE OR REPLACE FUNCTION public.get_taxonomy_inbox(
  p_claim_type text DEFAULT NULL,
  p_limit      int  DEFAULT 100
)
RETURNS TABLE (
  claim_type text,
  label text,
  claim_count bigint,
  paper_count bigint,
  last_seen_at timestamptz
)
SECURITY DEFINER SET search_path = pg_catalog
LANGUAGE sql STABLE AS $$
  SELECT i.claim_type, i.label, i.claim_count, i.paper_count, i.last_seen_at
  FROM knowledge.taxonomy_inbox i
  WHERE p_claim_type IS NULL OR i.claim_type = p_claim_type
  ORDER BY i.claim_count DESC, i.label
  LIMIT greatest(1, least(coalesce(p_limit, 100), 500));
$$;

REVOKE EXECUTE ON FUNCTION public.get_taxonomy_inbox(text, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_taxonomy_inbox(text, int) TO authenticated, service_role;
