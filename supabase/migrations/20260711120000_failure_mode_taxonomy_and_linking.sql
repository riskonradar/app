-- Failure-mode taxonomy + claim linking (Phase 1 taxonomy spine).
-- 1. knowledge.failure_modes: hierarchical controlled vocabulary seeded from the
--    flat Python alias dictionary (failure_modes.py), with the sub-modes it lost
--    (LCF/HCF/fretting under Fatigue, SCC/pitting under Corrosion, ...).
-- 2. knowledge.claim_failure_mode_links: claim -> taxonomy node links.
-- 3. knowledge.link_failure_mode_claims(): auto-linker (exact -> alias -> trigram).
-- 4. knowledge.link_component_claims(): REPLACED — fixes the inverted dry-run bug
--    (preview returned nothing) and now skips superseded claims.
-- 5. knowledge.taxonomy_inbox + public.get_taxonomy_inbox(): unresolved labels
--    queue for human curation.

-- ============================================================
-- knowledge.failure_modes
-- ============================================================

CREATE TABLE IF NOT EXISTS knowledge.failure_modes (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text        NOT NULL UNIQUE,
  slug        text        NOT NULL UNIQUE
              CONSTRAINT failure_modes_slug_format CHECK (slug ~ '^[a-z0-9][a-z0-9\-]*$'),
  parent_id   uuid        REFERENCES knowledge.failure_modes(id) ON DELETE RESTRICT,
  path        text        NOT NULL UNIQUE,
  depth       smallint    NOT NULL DEFAULT 0 CHECK (depth BETWEEN 0 AND 5),
  aliases     text[]      NOT NULL DEFAULT '{}',
  description text,
  is_leaf     boolean     NOT NULL DEFAULT true,
  is_active   boolean     NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER set_failure_modes_updated_at
  BEFORE UPDATE ON knowledge.failure_modes
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

CREATE INDEX failure_modes_path_idx ON knowledge.failure_modes (path text_pattern_ops);
CREATE INDEX failure_modes_name_trgm_idx ON knowledge.failure_modes USING gin (name extensions.gin_trgm_ops);
CREATE INDEX failure_modes_parent_id_idx ON knowledge.failure_modes (parent_id);

ALTER TABLE knowledge.failure_modes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "open read failure_modes" ON knowledge.failure_modes FOR SELECT USING (true);

-- ============================================================
-- knowledge.claim_failure_mode_links
-- ============================================================

CREATE TABLE IF NOT EXISTS knowledge.claim_failure_mode_links (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  evidence_claim_id uuid        NOT NULL REFERENCES knowledge.evidence_claims(id) ON DELETE CASCADE,
  failure_mode_id   uuid        NOT NULL REFERENCES knowledge.failure_modes(id) ON DELETE RESTRICT,
  link_method       text        NOT NULL DEFAULT 'auto_exact'
                    CHECK (link_method IN ('auto_exact','auto_fuzzy','auto_inferred','manual')),
  match_score       numeric(5,4),
  confidence        numeric(5,4) NOT NULL DEFAULT 0.0,
  review_status     text        NOT NULL DEFAULT 'needs_review'
                    CHECK (review_status IN ('needs_review','accepted','rejected')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (evidence_claim_id, failure_mode_id)
);

CREATE TRIGGER set_claim_failure_mode_links_updated_at
  BEFORE UPDATE ON knowledge.claim_failure_mode_links
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

CREATE INDEX claim_failure_mode_links_claim_idx ON knowledge.claim_failure_mode_links (evidence_claim_id);
CREATE INDEX claim_failure_mode_links_fm_idx ON knowledge.claim_failure_mode_links (failure_mode_id);

ALTER TABLE knowledge.claim_failure_mode_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY "open read claim_failure_mode_links" ON knowledge.claim_failure_mode_links FOR SELECT USING (true);

-- ============================================================
-- SEED — 27 mechanism families + 15 sub-modes.
-- Root names equal the canonical labels the classifier already writes,
-- so every existing normalized_value exact-matches a node by name.
-- ============================================================

INSERT INTO knowledge.failure_modes (name, slug, parent_id, path, depth, aliases, is_leaf) VALUES
('Crack / fracture', 'crack-fracture', null, 'crack-fracture', 0,
 ARRAY['cracking','crack','cracks','fracture','rupture','burst','breakage','burst / rupture','creep rupture'], true),
('Fatigue', 'fatigue', null, 'fatigue', 0,
 ARRAY['fatigue failure','fatigue crack','fatigue life','fatigue cracking'], false),
('Foreign object damage (FOD)', 'foreign-object-damage', null, 'foreign-object-damage', 0,
 ARRAY['fod','foreign object damage','foreign object impact','bird strike','impact damage','ingestion damage','ice ingestion','particle ingestion','sand ingestion','particle/sand ingestion'], true),
('Stall / surge', 'stall-surge', null, 'stall-surge', 0,
 ARRAY['stall','surge','compressor stall','rotating stall','compressor stall / surge'], true),
('Flow disturbance / distortion', 'flow-disturbance', null, 'flow-disturbance', 0,
 ARRAY['flow turbulence','flow disturbance','flow distortion','flow instability','swirl distortion','potential flow disturbance','flow turbulence / disturbance'], true),
('Blade vibration / flutter', 'blade-vibration-flutter', null, 'blade-vibration-flutter', 0,
 ARRAY['flutter','mistuning','stall flutter','blade flutter','rotor flutter','blade vibration','aeroelastic instability','blade mistuning'], true),
('Deformation / buckling', 'deformation-buckling', null, 'deformation-buckling', 0,
 ARRAY['deformation','buckling','bulging','bending deformation','flexural deformation'], true),
('Wear / rubbing', 'wear-rubbing', null, 'wear-rubbing', 0,
 ARRAY['wear','rubbing','scuffing','scuff','tip rub','bearing wear','wear/rubbing'], false),
('Corrosion / pitting', 'corrosion-pitting', null, 'corrosion-pitting', 0,
 ARRAY['corrosion','rusting','rustiness','hot corrosion','corrosion/rusting'], false),
('Deposits / blockage', 'deposits-blockage', null, 'deposits-blockage', 0,
 ARRAY['deposits','fouling','coking','clogging','blockage','blocked','carbon deposition','carbon deposit','fuel coking','deposits / fouling'], true),
('Leakage', 'leakage', null, 'leakage', 0,
 ARRAY['leak','oil leakage','oil leak','fuel leakage','fuel leak'], true),
('Overheating / overtemperature', 'overheating', null, 'overheating', 0,
 ARRAY['overheating','overtemperature','overheating/overtemperature'], true),
('Burn-through', 'burn-through', null, 'burn-through', 0,
 ARRAY['burned-through','burn through'], true),
('Bearing fault', 'bearing-fault', null, 'bearing-fault', 0,
 ARRAY['bearing faults','bearing defect','ball bearing faults','ball-bearing faults'], true),
('Spallation', 'spallation', null, 'spallation', 0,
 ARRAY['spalling','bearing spallation','coating spallation','thermal barrier coating spallation'], true),
('Seizure', 'seizure', null, 'seizure', 0, ARRAY['bearing seizure'], true),
('Creep', 'creep', null, 'creep', 0, ARRAY[]::text[], true),
('Erosion', 'erosion', null, 'erosion', 0, ARRAY[]::text[], true),
('Oxidation', 'oxidation', null, 'oxidation', 0, ARRAY[]::text[], true),
('Delamination', 'delamination', null, 'delamination', 0, ARRAY[]::text[], true),
('Debonding', 'debonding', null, 'debonding', 0, ARRAY[]::text[], true),
('Coating failure', 'coating-failure', null, 'coating-failure', 0,
 ARRAY['coating degradation'], true),
('Thermal shock', 'thermal-shock', null, 'thermal-shock', 0, ARRAY[]::text[], true),
('Combustion instability', 'combustion-instability', null, 'combustion-instability', 0, ARRAY[]::text[], true),
('Rotor imbalance', 'rotor-imbalance', null, 'rotor-imbalance', 0,
 ARRAY['imbalance','unbalance'], true),
('Misalignment', 'misalignment', null, 'misalignment', 0, ARRAY[]::text[], true),
('Overspeed', 'overspeed', null, 'overspeed', 0, ARRAY['over-speed'], true);

-- Fatigue sub-modes (the distinctions the flat dictionary collapsed)
INSERT INTO knowledge.failure_modes (name, slug, parent_id, path, depth, aliases, is_leaf) VALUES
('Low-cycle fatigue', 'low-cycle-fatigue',
 (SELECT id FROM knowledge.failure_modes WHERE slug='fatigue'), 'fatigue/low-cycle-fatigue', 1,
 ARRAY['lcf','low cycle fatigue','low-cycle fatigue (lcf)'], true),
('High-cycle fatigue', 'high-cycle-fatigue',
 (SELECT id FROM knowledge.failure_modes WHERE slug='fatigue'), 'fatigue/high-cycle-fatigue', 1,
 ARRAY['hcf','high cycle fatigue','high-cycle fatigue (hcf)','vhcf','very high cycle fatigue','very-high-cycle fatigue (vhcf)'], true),
('Thermo-mechanical fatigue', 'thermo-mechanical-fatigue',
 (SELECT id FROM knowledge.failure_modes WHERE slug='fatigue'), 'fatigue/thermo-mechanical-fatigue', 1,
 ARRAY['tmf','thermal fatigue','thermomechanical fatigue','thermo-mechanical fatigue (tmf)'], true),
('Fretting fatigue', 'fretting-fatigue',
 (SELECT id FROM knowledge.failure_modes WHERE slug='fatigue'), 'fatigue/fretting-fatigue', 1, ARRAY[]::text[], true),
('Corrosion fatigue', 'corrosion-fatigue',
 (SELECT id FROM knowledge.failure_modes WHERE slug='fatigue'), 'fatigue/corrosion-fatigue', 1, ARRAY[]::text[], true),
('Dwell fatigue', 'dwell-fatigue',
 (SELECT id FROM knowledge.failure_modes WHERE slug='fatigue'), 'fatigue/dwell-fatigue', 1, ARRAY[]::text[], true);

-- Wear sub-modes
INSERT INTO knowledge.failure_modes (name, slug, parent_id, path, depth, aliases, is_leaf) VALUES
('Abrasive wear', 'abrasive-wear',
 (SELECT id FROM knowledge.failure_modes WHERE slug='wear-rubbing'), 'wear-rubbing/abrasive-wear', 1, ARRAY[]::text[], true),
('Fretting wear', 'fretting-wear',
 (SELECT id FROM knowledge.failure_modes WHERE slug='wear-rubbing'), 'wear-rubbing/fretting-wear', 1,
 ARRAY['fretting'], true),
('Adhesive wear', 'adhesive-wear',
 (SELECT id FROM knowledge.failure_modes WHERE slug='wear-rubbing'), 'wear-rubbing/adhesive-wear', 1,
 ARRAY['galling'], true);

-- Corrosion sub-modes (fixes the "SCC -> Corrosion / pitting" information loss)
INSERT INTO knowledge.failure_modes (name, slug, parent_id, path, depth, aliases, is_leaf) VALUES
('Pitting corrosion', 'pitting-corrosion',
 (SELECT id FROM knowledge.failure_modes WHERE slug='corrosion-pitting'), 'corrosion-pitting/pitting-corrosion', 1,
 ARRAY['pitting'], true),
('Stress corrosion cracking', 'stress-corrosion-cracking',
 (SELECT id FROM knowledge.failure_modes WHERE slug='corrosion-pitting'), 'corrosion-pitting/stress-corrosion-cracking', 1,
 ARRAY['scc'], true),
('Galvanic corrosion', 'galvanic-corrosion',
 (SELECT id FROM knowledge.failure_modes WHERE slug='corrosion-pitting'), 'corrosion-pitting/galvanic-corrosion', 1, ARRAY[]::text[], true),
('Crevice corrosion', 'crevice-corrosion',
 (SELECT id FROM knowledge.failure_modes WHERE slug='corrosion-pitting'), 'corrosion-pitting/crevice-corrosion', 1, ARRAY[]::text[], true),
('Hydrogen embrittlement', 'hydrogen-embrittlement',
 (SELECT id FROM knowledge.failure_modes WHERE slug='corrosion-pitting'), 'corrosion-pitting/hydrogen-embrittlement', 1,
 ARRAY['hydrogen damage'], true);

-- ============================================================
-- COMPONENT LINKER — replaced.
-- Fixes the inverted dry-run (WHERE NOT p_dry_run made preview empty and
-- duplicated the match logic); now also skips superseded claims.
-- ============================================================

CREATE OR REPLACE FUNCTION knowledge.link_component_claims(
  p_dry_run boolean DEFAULT false
)
RETURNS TABLE (claim_id uuid, normalized_value text, matched_slug text, match_method text, match_score numeric)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_threshold numeric := 0.45;
BEGIN
  DROP TABLE IF EXISTS _component_matches;
  CREATE TEMP TABLE _component_matches AS
  WITH unlinked AS (
    SELECT ec.id, ec.normalized_value AS label
    FROM knowledge.evidence_claims ec
    WHERE ec.claim_type = 'component'
      AND ec.normalized_value IS NOT NULL
      AND ec.review_status NOT IN ('rejected', 'superseded')
      AND NOT EXISTS (
        SELECT 1 FROM knowledge.claim_component_links ccl
        WHERE ccl.evidence_claim_id = ec.id AND ccl.review_status != 'rejected'
      )
  ),
  exact_matches AS (
    SELECT u.id AS claim_id, u.label, c.id AS node_id, c.slug,
           'auto_exact'::text AS method, 1.0::numeric AS score
    FROM unlinked u
    JOIN knowledge.components c ON c.is_active = true
      AND (
        lower(c.name) = lower(u.label)
        OR lower(u.label) = ANY(SELECT lower(a) FROM unnest(c.aliases) a)
      )
  ),
  fuzzy_matches AS (
    SELECT DISTINCT ON (u.id)
      u.id AS claim_id, u.label, c.id AS node_id, c.slug,
      'auto_fuzzy'::text AS method,
      extensions.similarity(lower(u.label), lower(c.name))::numeric AS score
    FROM unlinked u
    JOIN knowledge.components c ON c.is_active = true AND c.is_leaf = true
      AND extensions.similarity(lower(u.label), lower(c.name)) >= v_threshold
    WHERE u.id NOT IN (SELECT em.claim_id FROM exact_matches em)
    ORDER BY u.id, extensions.similarity(lower(u.label), lower(c.name)) DESC
  )
  SELECT * FROM exact_matches UNION ALL SELECT * FROM fuzzy_matches;

  IF NOT p_dry_run THEN
    INSERT INTO knowledge.claim_component_links
      (evidence_claim_id, component_id, link_method, match_score, confidence, review_status)
    SELECT m.claim_id, m.node_id, m.method, m.score,
           CASE WHEN m.method = 'auto_exact' THEN 0.90 ELSE m.score * 0.70 END,
           'needs_review'
    FROM _component_matches m
    ON CONFLICT (evidence_claim_id, component_id) DO UPDATE
      SET match_score = EXCLUDED.match_score, confidence = EXCLUDED.confidence, updated_at = now();
  END IF;

  RETURN QUERY SELECT m.claim_id, m.label, m.slug, m.method, m.score FROM _component_matches m;
  DROP TABLE _component_matches;
END;
$$;

-- ============================================================
-- FAILURE-MODE LINKER — same ladder, fuzzy against all active nodes
-- ============================================================

CREATE OR REPLACE FUNCTION knowledge.link_failure_mode_claims(
  p_dry_run boolean DEFAULT false
)
RETURNS TABLE (claim_id uuid, normalized_value text, matched_slug text, match_method text, match_score numeric)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_threshold numeric := 0.45;
BEGIN
  DROP TABLE IF EXISTS _fm_matches;
  CREATE TEMP TABLE _fm_matches AS
  WITH unlinked AS (
    SELECT ec.id, ec.normalized_value AS label
    FROM knowledge.evidence_claims ec
    WHERE ec.claim_type = 'failure_mode'
      AND ec.normalized_value IS NOT NULL
      AND ec.review_status NOT IN ('rejected', 'superseded')
      AND NOT EXISTS (
        SELECT 1 FROM knowledge.claim_failure_mode_links l
        WHERE l.evidence_claim_id = ec.id AND l.review_status != 'rejected'
      )
  ),
  exact_matches AS (
    SELECT u.id AS claim_id, u.label, fm.id AS node_id, fm.slug,
           'auto_exact'::text AS method, 1.0::numeric AS score
    FROM unlinked u
    JOIN knowledge.failure_modes fm ON fm.is_active = true
      AND (
        lower(fm.name) = lower(u.label)
        OR lower(u.label) = ANY(SELECT lower(a) FROM unnest(fm.aliases) a)
      )
  ),
  fuzzy_matches AS (
    SELECT DISTINCT ON (u.id)
      u.id AS claim_id, u.label, fm.id AS node_id, fm.slug,
      'auto_fuzzy'::text AS method,
      extensions.similarity(lower(u.label), lower(fm.name))::numeric AS score
    FROM unlinked u
    JOIN knowledge.failure_modes fm ON fm.is_active = true
      AND extensions.similarity(lower(u.label), lower(fm.name)) >= v_threshold
    WHERE u.id NOT IN (SELECT em.claim_id FROM exact_matches em)
    ORDER BY u.id, extensions.similarity(lower(u.label), lower(fm.name)) DESC
  )
  SELECT * FROM exact_matches UNION ALL SELECT * FROM fuzzy_matches;

  IF NOT p_dry_run THEN
    INSERT INTO knowledge.claim_failure_mode_links
      (evidence_claim_id, failure_mode_id, link_method, match_score, confidence, review_status)
    SELECT m.claim_id, m.node_id, m.method, m.score,
           CASE WHEN m.method = 'auto_exact' THEN 0.90 ELSE m.score * 0.70 END,
           'needs_review'
    FROM _fm_matches m
    ON CONFLICT (evidence_claim_id, failure_mode_id) DO UPDATE
      SET match_score = EXCLUDED.match_score, confidence = EXCLUDED.confidence, updated_at = now();
  END IF;

  RETURN QUERY SELECT m.claim_id, m.label, m.slug, m.method, m.score FROM _fm_matches m;
  DROP TABLE _fm_matches;
END;
$$;

-- ============================================================
-- TAXONOMY INBOX — distinct unresolved labels, most frequent first.
-- The human curation queue: add alias / add node / reject as noise.
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
  )
GROUP BY ec.claim_type, lower(coalesce(ec.normalized_value, ec.raw_value));

CREATE OR REPLACE FUNCTION public.get_taxonomy_inbox(
  p_claim_type text DEFAULT NULL,
  p_limit      int  DEFAULT 100
)
RETURNS TABLE (claim_type text, label text, claim_count bigint, paper_count bigint, last_seen_at timestamptz)
SECURITY DEFINER LANGUAGE sql STABLE AS $$
  SELECT i.claim_type, i.label, i.claim_count, i.paper_count, i.last_seen_at
  FROM knowledge.taxonomy_inbox i
  WHERE p_claim_type IS NULL OR i.claim_type = p_claim_type
  ORDER BY i.claim_count DESC, i.label
  LIMIT p_limit;
$$;
