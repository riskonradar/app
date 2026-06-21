CREATE OR REPLACE FUNCTION public.get_turbofan_fmea(
  p_limit int DEFAULT 500
)
RETURNS TABLE (
  component text,
  failure_mode text,
  effect text,
  cause text,
  severity text,
  occurrence text,
  detection text,
  corrective_action text,
  rpn text,
  evidence_count bigint,
  sources jsonb,
  component_order int,
  source_record_count bigint,
  relevant_record_count bigint
)
SECURITY DEFINER
LANGUAGE sql STABLE
AS $$
  WITH source_records AS (
    SELECT
      'paper:' || pc.id::text AS record_id,
      pc.title,
      COALESCE(pc.publication_year::text, '') AS year,
      COALESCE(pc.doi, '') AS doi,
      COALESCE(pc.source_url, '') AS url,
      'journal_paper' AS category,
      ' ' || regexp_replace(lower(concat_ws(' ', pc.title, pc.abstract, pc.journal)), '[^a-z0-9]+', ' ', 'g') || ' ' AS full_text
    FROM papers_raw.paper_candidates pc
    JOIN papers_raw.discovery_runs dr ON dr.id = pc.discovery_run_id
    WHERE dr.query = 'turbofan engine'

    UNION ALL

    SELECT
      'easa:' || ea.id::text AS record_id,
      ea.ad_number || ' - ' || COALESCE(ea.title, '') AS title,
      COALESCE(EXTRACT(year FROM ea.issue_date)::int::text, '') AS year,
      '' AS doi,
      COALESCE(ea.primary_pdf_url, '') AS url,
      'easa_ad' AS category,
      ' ' || regexp_replace(lower(concat_ws(
        ' ',
        ea.title,
        ea.summary_text,
        ea.affected_products,
        ea.required_actions,
        ea.compliance_time,
        ea.approval_holder,
        ea.engine_family
      )), '[^a-z0-9]+', ' ', 'g') || ' ' AS full_text
    FROM public.easa_ads ea
    WHERE ea.keyword = 'turbofan'
  ),
  component_map(alias, label, ord) AS (VALUES
    ('engine inlet','Engine inlet / intake',1),('inlet duct liner','Engine inlet / intake',1),('duct liner','Engine inlet / intake',1),('intake','Engine inlet / intake',1),('inlet','Engine inlet / intake',1),
    ('fan blade','Fan / fan blade',2),('fan blades','Fan / fan blade',2),('fan rotor','Fan / fan blade',2),('fan disk','Fan / fan blade',2),('fan disc','Fan / fan blade',2),
    ('fan case','Fan case',3),('fan casing','Fan case',3),('fan containment','Fan case',3),('fan duct','Fan case',3),
    ('nacelle','Nacelle',4),('nose cowl','Nacelle',4),('cowling','Nacelle',4),
    ('engine mount','Engine mount',5),('engine mounts','Engine mount',5),
    ('low pressure compressor','Low-pressure compressor',6),('low-pressure compressor','Low-pressure compressor',6),('lpc','Low-pressure compressor',6),
    ('high pressure compressor','High-pressure compressor',7),('high-pressure compressor','High-pressure compressor',7),('hpc','High-pressure compressor',7),('compressor blade','High-pressure compressor',7),
    ('combustor','Combustor',8),('combustion chamber','Combustor',8),
    ('fuel nozzle','Nozzle / fuel injector',9),('fuel nozzles','Nozzle / fuel injector',9),('nozzle','Nozzle / fuel injector',9),('nozzles','Nozzle / fuel injector',9),('injector','Nozzle / fuel injector',9),
    ('high pressure turbine','High-pressure turbine',10),('high-pressure turbine','High-pressure turbine',10),('hpt','High-pressure turbine',10),('hpt blade','High-pressure turbine',10),('turbine blade','High-pressure turbine',10),
    ('low pressure turbine','Low-pressure turbine',11),('low-pressure turbine','Low-pressure turbine',11),('lpt','Low-pressure turbine',11),('lpt blade','Low-pressure turbine',11),
    ('shaft / spool','Shaft',12),('rotor shaft','Shaft',12),('compressor shaft','Shaft',12),('spool','Shaft',12),('shaft','Shaft',12),
    ('roller bearing','Bearing',13),('ball bearing','Bearing',13),('bearing','Bearing',13),('bearings','Bearing',13),
    ('front air seal','Seal',14),('seal','Seal',14),('seals','Seal',14),
    ('oil system','Oil system / lubrication',15),('lubrication system','Oil system / lubrication',15),('engine oil','Oil system / lubrication',15),('oil filter','Oil system / lubrication',15),
    ('oil pump','Pump',16),('scavenge oil pump','Pump',16),('lubrication pump','Pump',16),('fuel pump','Pump',16),('piston pump','Pump',16),('pump','Pump',16),('pumps','Pump',16),
    ('valve','Valve',17),('valves','Valve',17),
    ('gearbox','Gearbox / accessory gearbox',18),('accessory gearbox','Gearbox / accessory gearbox',18),('spiral bevel gear','Gearbox / accessory gearbox',18),('gear','Gearbox / accessory gearbox',18),
    ('sensor','Sensor / instrumentation',19),('sensors','Sensor / instrumentation',19),('fadec','Sensor / instrumentation',19),('actuator','Sensor / instrumentation',19),('actuators','Sensor / instrumentation',19),
    ('exhaust pipe','Exhaust',20),('exhaust pipes','Exhaust',20),('exhaust cone','Exhaust',20),('exhaust','Exhaust',20)
  ),
  failure_map(alias, label) AS (VALUES
    ('fan blade out','Fan blade out'),('blade out','Fan blade out'),('blade-off','Fan blade out'),('blade off','Fan blade out'),
    ('low cycle fatigue','Fatigue'),('high cycle fatigue','Fatigue'),('thermomechanical fatigue','Fatigue'),('thermal fatigue','Fatigue'),('fretting fatigue','Fatigue'),('fatigue','Fatigue'),
    ('crack','Crack / fracture'),('cracks','Crack / fracture'),('cracking','Crack / fracture'),('fracture','Crack / fracture'),('rupture','Crack / fracture'),('burst','Crack / fracture'),('breakage','Crack / fracture'),
    ('deformation','Deformation / buckling'),('buckling','Deformation / buckling'),('bending','Deformation / buckling'),
    ('imbalance','Rotor imbalance'),('unbalance','Rotor imbalance'),
    ('flutter','Blade vibration / flutter'),('blade flutter','Blade vibration / flutter'),('mistuning','Blade vibration / flutter'),('aeroelastic','Blade vibration / flutter'),
    ('foreign object damage','Foreign object damage (FOD)'),('foreign object impact','Foreign object damage (FOD)'),('bird strike','Foreign object damage (FOD)'),('bird strikes','Foreign object damage (FOD)'),('fod','Foreign object damage (FOD)'),('ice ingestion','Foreign object damage (FOD)'),('sand ingestion','Foreign object damage (FOD)'),
    ('flow distortion','Flow disturbance / distortion'),('swirl distortion','Flow disturbance / distortion'),('flow disturbance','Flow disturbance / distortion'),
    ('erosion','Erosion'),('stall','Stall / surge'),('surge','Stall / surge'),('creep','Creep'),('wear','Wear / rubbing'),('rubbing','Wear / rubbing'),('fretting','Wear / rubbing'),
    ('carbon deposition','Deposits / blockage'),('carbon deposit','Deposits / blockage'),('coking','Deposits / blockage'),('blockage','Deposits / blockage'),('clogging','Deposits / blockage'),('blocked','Deposits / blockage'),
    ('flexural vibration','Flexural deformation / vibration'),('flexural deformation','Flexural deformation / vibration'),('oxidation','Oxidation'),('overspeed','Overspeed'),('over-speed','Overspeed'),('corrosion','Corrosion / pitting'),('pitting','Corrosion / pitting'),('thermal shock','Thermal shock'),('combustion instability','Combustion instability'),('leakage','Leakage'),('leak','Leakage'),('misalignment','Misalignment'),('overtemperature','Overheating / overtemperature'),('overheating','Overheating / overtemperature'),('seizure','Seizure'),('spallation','Spallation'),('spalling','Spallation'),('contamination','Contamination'),('loss of pressure','Pressure loss'),('pressure loss','Pressure loss'),('uncontained failure','Uncontained failure'),('uncontained','Uncontained failure'),('malfunction','Functional failure')
  ),
  effect_map(alias, label) AS (VALUES
    ('loss of thrust','Loss of thrust'),('thrust loss','Loss of thrust'),('reduced thrust','Reduced thrust / performance loss'),('performance loss','Reduced thrust / performance loss'),('engine failure','Engine failure'),('engine shutdown','Engine shutdown'),('in flight shutdown','In-flight shutdown'),('shutdown','Engine shutdown'),('flow disturbance','Flow disturbance / distortion'),('flow turbulence','Flow turbulence / disturbance'),('vibration','High vibration'),('noise','Abnormal noise'),('oil debris','Oil debris'),('fire','Fire / overheat hazard'),('overheat','Fire / overheat hazard'),('metallic particles','Metallic particle generation'),('downstream components','Downstream component damage'),('hazardous engine effect','Hazardous engine effect'),('uncontained release','Uncontained release'),('damage to the aeroplane','Aircraft damage'),('damage to aircraft','Aircraft damage'),('loss of oil pressure','Loss of oil pressure'),('oil pressure loss','Loss of oil pressure'),('loss of fuel pressure','Loss of fuel pressure')
  ),
  cause_map(alias, label) AS (VALUES
    ('loss of coating','Loss of protective coating'),('inadequate oxidation protection','Inadequate oxidation protection'),('substrate material aging','Substrate material aging'),('under-filling','Manufacturing under-fill flaw'),('flaw near surface','Near-surface manufacturing flaw'),('fatigue striations','Progressive fatigue crack growth'),('thermal fatigue','Thermal cycling'),('fatigue','Cyclic stress loading'),('cavitation','Cavitation in fuel pump flow'),('swirl distortion','Inlet swirl distortion'),('bird strike','Bird ingestion / impact'),('foreign object','Foreign object ingestion'),('fod','Foreign object ingestion'),('carbon deposit','Carbon deposition'),('coking','Fuel thermal coking'),('oil starvation','Oil starvation'),('oil contamination','Oil contamination'),('misalignment','Rotor/shaft misalignment'),('imbalance','Rotor imbalance'),('overheating','Excess thermal loading'),('oxidation','High-temperature oxidation'),('creep','High-temperature creep exposure'),('corrosion','Corrosive environment'),('erosion','Particle/fluid erosion'),('wear','Contact wear'),('rubbing','Rotor-stator rubbing'),('combustion instability','Unstable combustion dynamics'),('incorrect installation','Incorrect installation'),('installation criteria','Incorrect installation'),('manufacturing defect','Manufacturing defect'),('material defect','Material defect'),('debris','Debris contamination'),('thermal degradation','Thermal degradation'),('excessive vibration','Excessive vibration'),('sudden imbalance','Rotor imbalance')
  ),
  component_hits AS (
    SELECT DISTINCT sr.record_id, cm.label, cm.ord
    FROM source_records sr
    JOIN component_map cm
      ON sr.full_text LIKE '% ' || regexp_replace(lower(cm.alias), '[^a-z0-9]+', ' ', 'g') || ' %'
  ),
  failure_hits AS (
    SELECT DISTINCT sr.record_id, fm.label
    FROM source_records sr
    JOIN failure_map fm
      ON sr.full_text LIKE '% ' || regexp_replace(lower(fm.alias), '[^a-z0-9]+', ' ', 'g') || ' %'
    WHERE fm.label NOT IN ('RUL degradation', 'Remaining useful life', 'Degradation')
  ),
  effect_hits AS (
    SELECT DISTINCT sr.record_id, em.label
    FROM source_records sr
    JOIN effect_map em
      ON sr.full_text LIKE '% ' || regexp_replace(lower(em.alias), '[^a-z0-9]+', ' ', 'g') || ' %'
  ),
  cause_hits AS (
    SELECT DISTINCT sr.record_id, cm.label
    FROM source_records sr
    JOIN cause_map cm
      ON sr.full_text LIKE '% ' || regexp_replace(lower(cm.alias), '[^a-z0-9]+', ' ', 'g') || ' %'
  ),
  matched AS (
    SELECT DISTINCT
      sr.record_id,
      sr.title,
      sr.year,
      sr.doi,
      sr.url,
      sr.category,
      ch.label AS component,
      ch.ord,
      fh.label AS failure_mode
    FROM source_records sr
    JOIN component_hits ch ON ch.record_id = sr.record_id
    JOIN failure_hits fh ON fh.record_id = sr.record_id
  ),
  source_rows AS (
    SELECT DISTINCT
      component,
      failure_mode,
      record_id,
      jsonb_build_object(
        'title', title,
        'year', year,
        'doi', doi,
        'url', url,
        'category', category
      ) AS source
    FROM matched
  ),
  assembled AS (
    SELECT
      m.component,
      m.failure_mode,
      COALESCE(string_agg(DISTINCT eh.label, '; ' ORDER BY eh.label), '') AS effect,
      COALESCE(string_agg(DISTINCT ch.label, '; ' ORDER BY ch.label), '') AS cause,
      min(m.ord) AS component_order,
      count(DISTINCT m.record_id) AS evidence_count,
      COALESCE(jsonb_agg(DISTINCT sr.source), '[]'::jsonb) AS sources
    FROM matched m
    LEFT JOIN effect_hits eh ON eh.record_id = m.record_id
    LEFT JOIN cause_hits ch ON ch.record_id = m.record_id
    LEFT JOIN source_rows sr ON sr.component = m.component AND sr.failure_mode = m.failure_mode
    GROUP BY m.component, m.failure_mode
  )
  SELECT
    assembled.component,
    assembled.failure_mode,
    assembled.effect,
    assembled.cause,
    '' AS severity,
    '' AS occurrence,
    '' AS detection,
    '' AS corrective_action,
    '' AS rpn,
    assembled.evidence_count,
    assembled.sources,
    assembled.component_order,
    (SELECT count(*) FROM source_records) AS source_record_count,
    (SELECT count(DISTINCT record_id) FROM matched) AS relevant_record_count
  FROM assembled
  ORDER BY assembled.component_order, assembled.evidence_count DESC, assembled.failure_mode
  LIMIT p_limit;
$$;
