-- Component taxonomy: a controlled vocabulary for engineering parts.
-- Provides hierarchy (bearing → rolling element bearing → cylindrical roller bearing),
-- aliases for auto-linking LLM-extracted component claims, and search functions.

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;

-- ============================================================
-- knowledge.components
-- Domain-agnostic part taxonomy. One node per canonical part type.
-- Industry/domain context lives in application claims, not here.
-- ============================================================

CREATE TABLE IF NOT EXISTS knowledge.components (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text        NOT NULL UNIQUE,
  slug        text        NOT NULL UNIQUE
              CONSTRAINT components_slug_format CHECK (slug ~ '^[a-z0-9][a-z0-9\-]*$'),
  parent_id   uuid        REFERENCES knowledge.components(id) ON DELETE RESTRICT,
  -- Materialized path of slugs: "bearing/rolling-element-bearing/cylindrical-roller-bearing"
  -- Enables subtree queries: WHERE path LIKE 'bearing%'
  path        text        NOT NULL UNIQUE,
  depth       smallint    NOT NULL DEFAULT 0
              CHECK (depth BETWEEN 0 AND 5),
  -- Variant spellings / abbreviations for auto-linking
  aliases     text[]      NOT NULL DEFAULT '{}',
  description text,
  is_leaf     boolean     NOT NULL DEFAULT true,
  is_active   boolean     NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER set_components_updated_at
  BEFORE UPDATE ON knowledge.components
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

-- Subtree lookup: path LIKE 'bearing%' finds all bearing subtypes
CREATE INDEX components_path_idx ON knowledge.components (path text_pattern_ops);
-- Fuzzy name matching for auto-linker
CREATE INDEX components_name_trgm_idx ON knowledge.components USING gin (name extensions.gin_trgm_ops);
CREATE INDEX components_parent_id_idx ON knowledge.components (parent_id);

ALTER TABLE knowledge.components ENABLE ROW LEVEL SECURITY;
CREATE POLICY "open read components" ON knowledge.components FOR SELECT USING (true);

-- ============================================================
-- knowledge.claim_component_links
-- Links evidence_claims (claim_type='component') to taxonomy nodes.
-- ============================================================

CREATE TABLE IF NOT EXISTS knowledge.claim_component_links (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  evidence_claim_id uuid        NOT NULL REFERENCES knowledge.evidence_claims(id) ON DELETE CASCADE,
  component_id      uuid        NOT NULL REFERENCES knowledge.components(id) ON DELETE RESTRICT,
  link_method       text        NOT NULL DEFAULT 'auto_exact'
                    CHECK (link_method IN ('auto_exact','auto_fuzzy','auto_inferred','manual')),
  match_score       numeric(5,4),
  confidence        numeric(5,4) NOT NULL DEFAULT 0.0,
  review_status     text        NOT NULL DEFAULT 'needs_review'
                    CHECK (review_status IN ('needs_review','accepted','rejected')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (evidence_claim_id, component_id)
);

CREATE TRIGGER set_claim_component_links_updated_at
  BEFORE UPDATE ON knowledge.claim_component_links
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

CREATE INDEX claim_component_links_claim_idx ON knowledge.claim_component_links (evidence_claim_id);
CREATE INDEX claim_component_links_component_idx ON knowledge.claim_component_links (component_id);

ALTER TABLE knowledge.claim_component_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY "open read claim_component_links" ON knowledge.claim_component_links FOR SELECT USING (true);

-- ============================================================
-- SEED TAXONOMY — 42 nodes
-- Insert order: parents before children
-- ============================================================

INSERT INTO knowledge.components (name, slug, parent_id, path, depth, aliases, description, is_leaf) VALUES

-- Level 0: categories (grouping nodes)
('Rotating Machinery',   'rotating-machinery',   null, 'rotating-machinery',   0, '{}', 'Components that rotate during operation', false),
('Static Structures',    'static-structures',    null, 'static-structures',    0, '{}', 'Non-rotating structural components', false),
('Fluid Systems',        'fluid-systems',        null, 'fluid-systems',        0, '{}', 'Pumps, valves, seals, pipes and fluid circuits', false),
('Electrical Systems',   'electrical-systems',   null, 'electrical-systems',   0, '{}', 'Electrical and power conversion components', false),
('Aero/Thermo Surfaces', 'aero-thermo-surfaces', null, 'aero-thermo-surfaces', 0, '{}', 'Blades, vanes, and thermally loaded surfaces', false),
('Joints and Fasteners', 'joints-fasteners',     null, 'joints-fasteners',     0, '{}', 'Bolts, welds, and structural joints', false),

-- Level 1: functional groups under Rotating Machinery
('Bearing', 'bearing',
  (SELECT id FROM knowledge.components WHERE slug='rotating-machinery'),
  'rotating-machinery/bearing', 1,
  '{"bearings","rolling bearing","plain bearing","sleeve bearing"}',
  'Load-carrying element between two surfaces in relative motion', false),

('Gearbox', 'gearbox',
  (SELECT id FROM knowledge.components WHERE slug='rotating-machinery'),
  'rotating-machinery/gearbox', 1,
  '{"gear box","gear train","gears","geartrain"}',
  'Power transmission assembly of meshing gears', false),

('Shaft', 'shaft',
  (SELECT id FROM knowledge.components WHERE slug='rotating-machinery'),
  'rotating-machinery/shaft', 1,
  '{"shafts","rotor shaft","drive shaft","spindle","axle"}',
  'Rotating cylindrical member transmitting torque', true),

('Gear', 'gear',
  (SELECT id FROM knowledge.components WHERE slug='rotating-machinery'),
  'rotating-machinery/gear', 1,
  '{"gears","gear tooth","tooth","gear teeth","pinion","helical gear","spur gear"}',
  'Individual toothed wheel in a gear train', true),

-- Level 2: Bearing subtypes
('Rolling Element Bearing', 'rolling-element-bearing',
  (SELECT id FROM knowledge.components WHERE slug='bearing'),
  'rotating-machinery/bearing/rolling-element-bearing', 2,
  '{"rolling bearing","anti-friction bearing","roller bearing"}',
  'Bearing using rolling elements (balls or rollers) between races', false),

('Plain Bearing', 'plain-bearing',
  (SELECT id FROM knowledge.components WHERE slug='bearing'),
  'rotating-machinery/bearing/plain-bearing', 2,
  '{"sleeve bearing","journal bearing","bushing","bushings","plain bearings"}',
  'Bearing relying on a sliding contact surface', true),

-- Level 3: Rolling element subtypes
('Ball Bearing', 'ball-bearing',
  (SELECT id FROM knowledge.components WHERE slug='rolling-element-bearing'),
  'rotating-machinery/bearing/rolling-element-bearing/ball-bearing', 3,
  '{"ball bearings","deep groove ball bearing","angular contact bearing","deep-groove ball bearing"}',
  'Rolling element bearing using balls', true),

('Cylindrical Roller Bearing', 'cylindrical-roller-bearing',
  (SELECT id FROM knowledge.components WHERE slug='rolling-element-bearing'),
  'rotating-machinery/bearing/rolling-element-bearing/cylindrical-roller-bearing', 3,
  '{"cylindrical roller bearings","cylindrical roller bearing"}',
  'Roller bearing with cylindrical rolling elements', true),

('Tapered Roller Bearing', 'tapered-roller-bearing',
  (SELECT id FROM knowledge.components WHERE slug='rolling-element-bearing'),
  'rotating-machinery/bearing/rolling-element-bearing/tapered-roller-bearing', 3,
  '{"tapered roller bearings","taper bearing","tapered bearing"}',
  'Roller bearing for combined axial and radial load', true),

('Thrust Bearing', 'thrust-bearing',
  (SELECT id FROM knowledge.components WHERE slug='rolling-element-bearing'),
  'rotating-machinery/bearing/rolling-element-bearing/thrust-bearing', 3,
  '{"thrust bearings","axial bearing"}',
  'Bearing designed primarily for axial (thrust) loads', true),

('Main Shaft Bearing', 'main-shaft-bearing',
  (SELECT id FROM knowledge.components WHERE slug='rolling-element-bearing'),
  'rotating-machinery/bearing/rolling-element-bearing/main-shaft-bearing', 3,
  '{"main bearing","main bearings","main shaft bearing","LSS bearing","low-speed shaft bearing"}',
  'Large-diameter bearing on the primary shaft (wind turbine)', true),

-- Level 2: Gearbox subtypes
('Accessory Gearbox', 'accessory-gearbox',
  (SELECT id FROM knowledge.components WHERE slug='gearbox'),
  'rotating-machinery/gearbox/accessory-gearbox', 2,
  '{"AGB","accessory gear box","accessory drive gearbox","aircraft accessory gearbox"}',
  'Drives engine accessories: fuel pump, oil pump, generators (aviation)', true),

('Reduction Gearbox', 'reduction-gearbox',
  (SELECT id FROM knowledge.components WHERE slug='gearbox'),
  'rotating-machinery/gearbox/reduction-gearbox', 2,
  '{"reduction gear","speed reducer","step-down gearbox","main gearbox"}',
  'Steps down rotational speed (wind turbine, marine)', true),

('Epicyclic Gearbox', 'epicyclic-gearbox',
  (SELECT id FROM knowledge.components WHERE slug='gearbox'),
  'rotating-machinery/gearbox/epicyclic-gearbox', 2,
  '{"planetary gearbox","planetary gear","epicyclic gear","planetary gear train"}',
  'Compact multi-stage gear arrangement with planet gears', true),

-- Aero/Thermo Surfaces
('Blade', 'blade',
  (SELECT id FROM knowledge.components WHERE slug='aero-thermo-surfaces'),
  'aero-thermo-surfaces/blade', 1,
  '{"blades","aerofoil","airfoil"}',
  'Aerofoil section rotating within a turbomachine', false),

('Turbine Blade', 'turbine-blade',
  (SELECT id FROM knowledge.components WHERE slug='blade'),
  'aero-thermo-surfaces/blade/turbine-blade', 2,
  '{"turbine blades","HP turbine blade","LP turbine blade","high-pressure turbine blade","low-pressure turbine blade","nozzle guide vane","NGV","rotor blade"}',
  'Rotating or static aerofoil within a turbine stage', true),

('Fan Blade', 'fan-blade',
  (SELECT id FROM knowledge.components WHERE slug='blade'),
  'aero-thermo-surfaces/blade/fan-blade', 2,
  '{"fan blades","fan aerofoil","fan rotor blade","wide-chord fan blade"}',
  'First-stage wide-chord blade on a turbofan engine', true),

('Compressor Blade', 'compressor-blade',
  (SELECT id FROM knowledge.components WHERE slug='blade'),
  'aero-thermo-surfaces/blade/compressor-blade', 2,
  '{"compressor blades","stator vane","compressor vane","HP compressor blade","LP compressor blade","IPC blade","HPC blade"}',
  'Blade in a compressor stage', true),

('Wind Turbine Blade', 'wind-turbine-blade',
  (SELECT id FROM knowledge.components WHERE slug='blade'),
  'aero-thermo-surfaces/blade/wind-turbine-blade', 2,
  '{"wind blade","WTG blade","turbine rotor blade","rotor blade","wind turbine rotor blade"}',
  'Large composite blade on a wind turbine rotor', true),

('Combustor', 'combustor',
  (SELECT id FROM knowledge.components WHERE slug='aero-thermo-surfaces'),
  'aero-thermo-surfaces/combustor', 1,
  '{"combustion chamber","burner","flame tube","liner","combustion liner"}',
  'Chamber where fuel combustion occurs in a gas turbine', true),

('Nozzle', 'nozzle',
  (SELECT id FROM knowledge.components WHERE slug='aero-thermo-surfaces'),
  'aero-thermo-surfaces/nozzle', 1,
  '{"jet nozzle","exhaust nozzle","turbine nozzle","nozzle guide vane","convergent nozzle"}',
  'Flow-directing or thrust-generating component', true),

-- Fluid Systems
('Pump', 'pump',
  (SELECT id FROM knowledge.components WHERE slug='fluid-systems'),
  'fluid-systems/pump', 1,
  '{"pumps"}',
  'Device that moves fluid by mechanical action', false),

('Centrifugal Pump', 'centrifugal-pump',
  (SELECT id FROM knowledge.components WHERE slug='pump'),
  'fluid-systems/pump/centrifugal-pump', 2,
  '{"centrifugal pumps","radial pump"}',
  'Pump using centrifugal force to move fluid', true),

('Oil Pump', 'oil-pump',
  (SELECT id FROM knowledge.components WHERE slug='pump'),
  'fluid-systems/pump/oil-pump', 2,
  '{"oil pumps","scavenge pump","pressure pump","lube pump","lubrication pump"}',
  'Lubricant circulation pump in engine or gearbox', true),

('Fuel Pump', 'fuel-pump',
  (SELECT id FROM knowledge.components WHERE slug='pump'),
  'fluid-systems/pump/fuel-pump', 2,
  '{"fuel pumps","high-pressure fuel pump","HP fuel pump","fuel feed pump"}',
  'Pump pressurising fuel for combustion', true),

('Valve', 'valve',
  (SELECT id FROM knowledge.components WHERE slug='fluid-systems'),
  'fluid-systems/valve', 1,
  '{"valves","check valve","control valve","relief valve","safety valve","solenoid valve","PRV","PSV","ball valve","gate valve"}',
  'Device regulating or controlling flow of fluid', true),

('Seal', 'seal',
  (SELECT id FROM knowledge.components WHERE slug='fluid-systems'),
  'fluid-systems/seal', 1,
  '{"seals","gasket","O-ring","sealing element","lip seal"}',
  'Component preventing leakage between interfaces', false),

('Mechanical Seal', 'mechanical-seal',
  (SELECT id FROM knowledge.components WHERE slug='seal'),
  'fluid-systems/seal/mechanical-seal', 2,
  '{"mechanical seals","face seal","rotating seal","carbon seal","carbon face seal"}',
  'Seal using sliding contact between faces', true),

('Labyrinth Seal', 'labyrinth-seal',
  (SELECT id FROM knowledge.components WHERE slug='seal'),
  'fluid-systems/seal/labyrinth-seal', 2,
  '{"labyrinth seals","labyrinth","air seal","knife-edge seal"}',
  'Non-contact seal using tortuous flow path', true),

('Pipe', 'pipe',
  (SELECT id FROM knowledge.components WHERE slug='fluid-systems'),
  'fluid-systems/pipe', 1,
  '{"pipes","pipeline","tube","tubing","conduit","piping","flow line","riser"}',
  'Conduit for fluid transport', true),

-- Electrical Systems
('Power Converter', 'power-converter',
  (SELECT id FROM knowledge.components WHERE slug='electrical-systems'),
  'electrical-systems/power-converter', 1,
  '{"converter","inverter","power electronics","variable frequency drive","VFD","frequency converter","power module"}',
  'Electronic device converting electrical power between forms', true),

('Battery Cell', 'battery-cell',
  (SELECT id FROM knowledge.components WHERE slug='electrical-systems'),
  'electrical-systems/battery-cell', 1,
  '{"battery","cell","lithium-ion cell","module","battery pack","energy storage cell","Li-ion cell","LIB"}',
  'Electrochemical cell storing electrical energy', true),

('Sensor', 'sensor',
  (SELECT id FROM knowledge.components WHERE slug='electrical-systems'),
  'electrical-systems/sensor', 1,
  '{"sensors","temperature sensor","pressure sensor","vibration sensor","accelerometer","transducer","probe","thermocouple"}',
  'Device detecting physical conditions and converting to a signal', true),

-- Joints and Fasteners
('Bolt', 'bolt',
  (SELECT id FROM knowledge.components WHERE slug='joints-fasteners'),
  'joints-fasteners/bolt', 1,
  '{"bolts","fastening bolt","structural bolt","stud bolt","cap screw","fastener","threaded fastener"}',
  'Threaded fastener used to join structural components', true),

('Weld', 'weld',
  (SELECT id FROM knowledge.components WHERE slug='joints-fasteners'),
  'joints-fasteners/weld', 1,
  '{"welds","welded joint","weld joint","weld seam","weld toe","heat-affected zone","HAZ"}',
  'Fusion joint formed by melting and solidifying material', true),

('Spring', 'spring',
  (SELECT id FROM knowledge.components WHERE slug='joints-fasteners'),
  'joints-fasteners/spring', 1,
  '{"springs","coil spring","leaf spring","return spring","valve spring"}',
  'Elastic element storing mechanical energy', true);

-- ============================================================
-- AUTO-LINKER FUNCTION
-- Links component claims to taxonomy nodes via exact name/alias
-- match or pg_trgm fuzzy match. Safe to run repeatedly.
-- ============================================================

CREATE OR REPLACE FUNCTION knowledge.link_component_claims(
  p_dry_run boolean DEFAULT false
)
RETURNS TABLE (claim_id uuid, normalized_value text, matched_slug text, match_method text, match_score numeric)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_threshold numeric := 0.45;
BEGIN
  RETURN QUERY
  WITH unlinked AS (
    SELECT ec.id, ec.normalized_value
    FROM knowledge.evidence_claims ec
    WHERE ec.claim_type = 'component'
      AND ec.normalized_value IS NOT NULL
      AND ec.review_status != 'rejected'
      AND NOT EXISTS (
        SELECT 1 FROM knowledge.claim_component_links ccl
        WHERE ccl.evidence_claim_id = ec.id AND ccl.review_status != 'rejected'
      )
  ),
  exact_matches AS (
    SELECT u.id AS claim_id, u.normalized_value, c.slug, 'auto_exact'::text AS method, 1.0::numeric AS score, c.id AS comp_id
    FROM unlinked u
    JOIN knowledge.components c ON c.is_active = true
      AND (
        lower(c.name) = lower(u.normalized_value)
        OR lower(u.normalized_value) = ANY(SELECT lower(a) FROM unnest(c.aliases) a)
      )
  ),
  fuzzy_matches AS (
    SELECT DISTINCT ON (u.id)
      u.id AS claim_id, u.normalized_value, c.slug, 'auto_fuzzy'::text AS method,
      extensions.similarity(lower(u.normalized_value), lower(c.name)) AS score, c.id AS comp_id
    FROM unlinked u
    JOIN knowledge.components c ON c.is_active = true AND c.is_leaf = true
      AND extensions.similarity(lower(u.normalized_value), lower(c.name)) >= v_threshold
    WHERE u.id NOT IN (SELECT claim_id FROM exact_matches)
    ORDER BY u.id, extensions.similarity(lower(u.normalized_value), lower(c.name)) DESC
  ),
  all_matches AS (
    SELECT * FROM exact_matches UNION ALL SELECT * FROM fuzzy_matches
  )
  SELECT am.claim_id, am.normalized_value, am.slug, am.method, am.score
  FROM all_matches am
  WHERE NOT p_dry_run;

  IF NOT p_dry_run THEN
    INSERT INTO knowledge.claim_component_links
      (evidence_claim_id, component_id, link_method, match_score, confidence, review_status)
    SELECT
      am.claim_id, am.comp_id, am.method, am.score,
      CASE WHEN am.method = 'auto_exact' THEN 0.90 ELSE am.score * 0.70 END,
      'needs_review'
    FROM (
      SELECT u.id AS claim_id, c.id AS comp_id, 'auto_exact'::text AS method, 1.0::numeric AS score
      FROM knowledge.evidence_claims u
      JOIN knowledge.components c ON c.is_active = true
        AND (lower(c.name) = lower(u.normalized_value)
             OR lower(u.normalized_value) = ANY(SELECT lower(a) FROM unnest(c.aliases) a))
      WHERE u.claim_type = 'component' AND u.normalized_value IS NOT NULL AND u.review_status != 'rejected'
        AND NOT EXISTS (SELECT 1 FROM knowledge.claim_component_links ccl WHERE ccl.evidence_claim_id = u.id AND ccl.review_status != 'rejected')
      UNION ALL
      SELECT DISTINCT ON (u.id) u.id, c.id, 'auto_fuzzy', extensions.similarity(lower(u.normalized_value), lower(c.name))
      FROM knowledge.evidence_claims u
      JOIN knowledge.components c ON c.is_active = true AND c.is_leaf = true
        AND extensions.similarity(lower(u.normalized_value), lower(c.name)) >= v_threshold
      WHERE u.claim_type = 'component' AND u.normalized_value IS NOT NULL AND u.review_status != 'rejected'
        AND NOT EXISTS (SELECT 1 FROM knowledge.claim_component_links ccl WHERE ccl.evidence_claim_id = u.id AND ccl.review_status != 'rejected')
        AND NOT EXISTS (
          SELECT 1 FROM knowledge.evidence_claims u2
          JOIN knowledge.components c2 ON c2.is_active = true
            AND (lower(c2.name) = lower(u2.normalized_value) OR lower(u2.normalized_value) = ANY(SELECT lower(a) FROM unnest(c2.aliases) a))
          WHERE u2.id = u.id
        )
      ORDER BY u.id, extensions.similarity(lower(u.normalized_value), lower(c.name)) DESC
    ) am
    ON CONFLICT (evidence_claim_id, component_id) DO UPDATE
      SET match_score = EXCLUDED.match_score, confidence = EXCLUDED.confidence, updated_at = now();
  END IF;
END;
$$;

-- ============================================================
-- SEARCH FUNCTION
-- Find FMEA evidence for a component slug (with subtree traversal)
-- and optional domain filter.
-- Example: SELECT * FROM public.search_fmea_by_component('bearing', 'aviation');
-- ============================================================

CREATE OR REPLACE FUNCTION public.search_fmea_by_component(
  p_component_slug   text,
  p_domain           text  DEFAULT null,
  p_limit            int   DEFAULT 100,
  p_offset           int   DEFAULT 0,
  p_min_confidence   numeric DEFAULT 0.0
)
RETURNS TABLE (
  failure_mode_id    uuid,
  component          text,
  component_slug     text,
  failure_mode       text,
  cause              text,
  effect             text,
  control            text,
  domain             text,
  confidence         numeric,
  doi                text,
  title              text,
  journal            text,
  publication_year   int,
  source             text
)
SECURITY DEFINER LANGUAGE sql STABLE AS $$
  WITH target AS (
    SELECT path FROM knowledge.components WHERE slug = p_component_slug AND is_active = true
  ),
  matched_components AS (
    SELECT ec.id AS claim_id, ec.paper_candidate_id, c.name AS comp_name, c.slug AS comp_slug, ccl.link_method
    FROM knowledge.claim_component_links ccl
    JOIN knowledge.evidence_claims ec ON ec.id = ccl.evidence_claim_id AND ec.claim_type = 'component'
    JOIN knowledge.components c ON c.id = ccl.component_id
    CROSS JOIN target t
    WHERE c.path LIKE t.path || '%' AND ccl.review_status != 'rejected' AND c.is_active = true
  ),
  domain_papers AS (
    SELECT DISTINCT paper_candidate_id, normalized_value AS domain
    FROM knowledge.evidence_claims
    WHERE claim_type = 'application'
      AND (p_domain IS NULL OR normalized_value ILIKE '%' || p_domain || '%')
  )
  SELECT
    fm.id, mc.comp_name, mc.comp_slug, fm.normalized_value,
    cause_c.normalized_value, eff_c.normalized_value, ctrl_c.normalized_value,
    dp.domain, fm.confidence,
    pc.doi, pc.title, pc.journal, pc.publication_year, pc.source
  FROM matched_components mc
  JOIN knowledge.claim_relationships has_fm
    ON has_fm.subject_claim_id = mc.claim_id AND has_fm.relationship_type = 'has_failure_mode'
  JOIN knowledge.evidence_claims fm
    ON fm.id = has_fm.object_claim_id AND fm.claim_type = 'failure_mode'
    AND fm.confidence >= p_min_confidence
  JOIN domain_papers dp ON dp.paper_candidate_id = mc.paper_candidate_id
  LEFT JOIN knowledge.claim_relationships r_cause
    ON r_cause.subject_claim_id = fm.id AND r_cause.relationship_type = 'caused_by'
  LEFT JOIN knowledge.evidence_claims cause_c ON cause_c.id = r_cause.object_claim_id
  LEFT JOIN knowledge.claim_relationships r_eff
    ON r_eff.subject_claim_id = fm.id AND r_eff.relationship_type = 'has_effect'
  LEFT JOIN knowledge.evidence_claims eff_c ON eff_c.id = r_eff.object_claim_id
  LEFT JOIN knowledge.claim_relationships r_ctrl
    ON r_ctrl.subject_claim_id = fm.id AND r_ctrl.relationship_type = 'mitigated_by'
  LEFT JOIN knowledge.evidence_claims ctrl_c ON ctrl_c.id = r_ctrl.object_claim_id
  JOIN papers_raw.paper_candidates pc ON pc.id = fm.paper_candidate_id
  ORDER BY fm.confidence DESC NULLS LAST
  LIMIT p_limit OFFSET p_offset;
$$;

-- ============================================================
-- TAXONOMY BROWSER
-- Returns children of a slug (or root nodes) with failure mode counts.
-- Example: SELECT * FROM public.get_component_taxonomy();
--          SELECT * FROM public.get_component_taxonomy('bearing');
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_component_taxonomy(
  p_parent_slug text DEFAULT null
)
RETURNS TABLE (
  id                 uuid,
  name               text,
  slug               text,
  path               text,
  depth              smallint,
  is_leaf            boolean,
  description        text,
  child_count        bigint,
  linked_claim_count bigint
)
SECURITY DEFINER LANGUAGE sql STABLE AS $$
  SELECT
    c.id, c.name, c.slug, c.path, c.depth, c.is_leaf, c.description,
    (SELECT count(*) FROM knowledge.components WHERE parent_id = c.id) AS child_count,
    (SELECT count(*) FROM knowledge.claim_component_links ccl
     JOIN knowledge.components subtree ON subtree.path LIKE c.path || '%'
     WHERE ccl.component_id = subtree.id AND ccl.review_status != 'rejected') AS linked_claim_count
  FROM knowledge.components c
  WHERE c.is_active = true
    AND (
      (p_parent_slug IS NULL AND c.parent_id IS NULL)
      OR c.parent_id = (SELECT id FROM knowledge.components WHERE slug = p_parent_slug)
    )
  ORDER BY linked_claim_count DESC, c.name;
$$;
