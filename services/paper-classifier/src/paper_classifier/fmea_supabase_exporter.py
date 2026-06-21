from __future__ import annotations

import argparse
import json
import os
from collections import OrderedDict
from pathlib import Path
from typing import Any

import psycopg
from psycopg.rows import dict_row

from paper_classifier.fmea_ris_classifier import (
    CAUSE_MAP,
    COMPONENT_MAP,
    EFFECT_MAP,
    FAILURE_MODE_MAP,
    add_unique,
    extract,
    patterns,
)


BASE_COMPONENT_ORDER = [
    "Engine inlet / intake",
    "Fan / fan blade",
    "Fan case",
    "Nacelle",
    "Engine mount",
    "Low-pressure compressor",
    "High-pressure compressor",
    "Combustor",
    "Nozzle / fuel injector",
    "High-pressure turbine",
    "Low-pressure turbine",
    "Shaft",
    "Bearing",
    "Seal",
    "Oil system / lubrication",
    "Pump",
    "Valve",
    "Gearbox / accessory gearbox",
    "Sensor / instrumentation",
    "Exhaust",
]

EXTENDED_COMPONENT_MAP = OrderedDict(
    [
        ("nacelle", "Nacelle"),
        ("nose cowl", "Nacelle"),
        ("cowling", "Nacelle"),
        ("engine mount", "Engine mount"),
        ("engine mounts", "Engine mount"),
        ("mount", "Engine mount"),
        ("low pressure turbine disc", "Low-pressure turbine"),
        ("low pressure turbine discs", "Low-pressure turbine"),
        ("low-pressure turbine disc", "Low-pressure turbine"),
        ("intermediate pressure compressor shaft", "Shaft"),
        ("compressor shaft", "Shaft"),
        ("rotor shaft", "Shaft"),
        ("front air seal", "Seal"),
        ("seal", "Seal"),
        ("seals", "Seal"),
        ("oil pump", "Pump"),
        ("scavenge oil pump", "Pump"),
        ("lubrication pump", "Pump"),
        ("fuel pump", "Pump"),
        ("piston pump", "Pump"),
        ("pump", "Pump"),
        ("pumps", "Pump"),
        ("valve", "Valve"),
        ("valves", "Valve"),
        ("fuel nozzle", "Nozzle / fuel injector"),
        ("fuel nozzles", "Nozzle / fuel injector"),
        ("nozzle", "Nozzle / fuel injector"),
        ("nozzles", "Nozzle / fuel injector"),
        ("injector", "Nozzle / fuel injector"),
        ("lubrication system", "Oil system / lubrication"),
        ("oil system", "Oil system / lubrication"),
        ("engine oil", "Oil system / lubrication"),
        ("oil filter", "Oil system / lubrication"),
        ("sensor", "Sensor / instrumentation"),
        ("sensors", "Sensor / instrumentation"),
        ("fadec", "Sensor / instrumentation"),
        ("actuator", "Sensor / instrumentation"),
        ("actuators", "Sensor / instrumentation"),
        ("exhaust pipe", "Exhaust"),
        ("exhaust pipes", "Exhaust"),
        ("exhaust cone", "Exhaust"),
        ("exhaust", "Exhaust"),
        *COMPONENT_MAP.items(),
    ]
)

EXTENDED_FAILURE_MODE_MAP = OrderedDict(
    [
        ("fan blade out", "Fan blade out"),
        ("blade out", "Fan blade out"),
        ("blade-off", "Fan blade out"),
        ("blade off", "Fan blade out"),
        ("oil leak", "Leakage"),
        ("fuel leak", "Leakage"),
        ("failure of the", "Functional failure"),
        ("malfunction", "Functional failure"),
        ("loss of pressure", "Pressure loss"),
        ("pressure loss", "Pressure loss"),
        ("contamination", "Contamination"),
        ("clogging", "Deposits / blockage"),
        ("blocked", "Deposits / blockage"),
        ("uncontained", "Uncontained failure"),
        ("uncontained failure", "Uncontained failure"),
        *FAILURE_MODE_MAP.items(),
    ]
)

EXTENDED_EFFECT_MAP = OrderedDict(
    [
        ("reduced control", "Reduced control authority"),
        ("loss of control", "Loss of control"),
        ("hazardous engine effect", "Hazardous engine effect"),
        ("uncontained release", "Uncontained release"),
        ("damage to the aeroplane", "Aircraft damage"),
        ("damage to aircraft", "Aircraft damage"),
        ("reduced braking", "Reduced braking / safety margin"),
        ("oil pressure loss", "Loss of oil pressure"),
        ("loss of oil pressure", "Loss of oil pressure"),
        ("loss of fuel pressure", "Loss of fuel pressure"),
        ("inability to restart", "Engine restart unavailable"),
        ("reduced engine thrust", "Reduced thrust / performance loss"),
        *EFFECT_MAP.items(),
    ]
)

EXTENDED_CAUSE_MAP = OrderedDict(
    [
        ("incorrect installation", "Incorrect installation"),
        ("installation criteria", "Incorrect installation"),
        ("manufacturing defect", "Manufacturing defect"),
        ("manufacturing quality", "Manufacturing quality escape"),
        ("material defect", "Material defect"),
        ("debris", "Debris contamination"),
        ("oil contamination", "Oil contamination"),
        ("fuel contamination", "Fuel contamination"),
        ("thermal degradation", "Thermal degradation"),
        ("excessive vibration", "Excessive vibration"),
        ("blade release", "Blade release event"),
        ("sudden imbalance", "Rotor imbalance"),
        *CAUSE_MAP.items(),
    ]
)


def export_fmea_from_supabase(database_url: str | None = None) -> dict[str, Any]:
    database_url = database_url or os.environ.get("DATABASE_URL") or os.environ.get("SUPABASE_DB_URL")
    if not database_url:
        raise RuntimeError("Set DATABASE_URL or SUPABASE_DB_URL to export Supabase FMEA data.")

    component_patterns = patterns(EXTENDED_COMPONENT_MAP)
    failure_patterns = patterns(EXTENDED_FAILURE_MODE_MAP)
    effect_patterns = patterns(EXTENDED_EFFECT_MAP)
    cause_patterns = patterns(EXTENDED_CAUSE_MAP)

    grouped: dict[tuple[str, str], dict[str, Any]] = {}
    record_count = 0
    relevant_record_ids: set[str] = set()

    with psycopg.connect(database_url, row_factory=dict_row) as connection:
        journal_records = connection.execute(
            """
            select
              pc.id::text,
              pc.title,
              pc.abstract,
              pc.journal,
              pc.publication_year,
              pc.doi,
              pc.source_url,
              pc.source,
              coalesce(
                jsonb_agg(
                  jsonb_build_object(
                    'claim_type', ec.claim_type,
                    'raw_value', ec.raw_value,
                    'normalized_value', ec.normalized_value
                  )
                ) filter (where ec.id is not null),
                '[]'::jsonb
              ) as claims
            from papers_raw.paper_candidates pc
            join papers_raw.discovery_runs dr on dr.id = pc.discovery_run_id
            left join knowledge.evidence_claims ec on ec.paper_candidate_id = pc.id
            where dr.query = 'turbofan engine'
            group by pc.id
            order by pc.publication_year desc nulls last, pc.title
            """
        ).fetchall()

        easa_records = connection.execute(
            """
            select
              id::text,
              ad_number,
              title,
              summary_text,
              affected_products,
              required_actions,
              compliance_time,
              approval_holder,
              engine_family,
              issue_date,
              primary_pdf_url
            from public.easa_ads
            where keyword = 'turbofan'
            order by issue_date desc nulls last, ad_number
            """
        ).fetchall()

    for record in journal_records:
        record_count += 1
        text = " ".join(
            str(part or "")
            for part in (
                record["title"],
                record["abstract"],
                record["journal"],
            )
        ).lower()
        claims = record["claims"] or []
        _add_record(
            grouped,
            record_id=f"paper:{record['id']}",
            source={
                "title": record["title"],
                "year": str(record["publication_year"] or ""),
                "doi": record["doi"] or "",
                "url": record["source_url"] or "",
                "category": "journal_paper",
            },
            text=text,
            claims=claims,
            component_patterns=component_patterns,
            failure_patterns=failure_patterns,
            effect_patterns=effect_patterns,
            cause_patterns=cause_patterns,
            relevant_record_ids=relevant_record_ids,
        )

    for record in easa_records:
        record_count += 1
        text = " ".join(
            str(part or "")
            for part in (
                record["title"],
                record["summary_text"],
                record["affected_products"],
                record["required_actions"],
                record["compliance_time"],
                record["approval_holder"],
                record["engine_family"],
            )
        ).lower()
        _add_record(
            grouped,
            record_id=f"easa:{record['id']}",
            source={
                "title": f"{record['ad_number']} - {record['title']}",
                "year": str(record["issue_date"].year if record["issue_date"] else ""),
                "doi": "",
                "url": record["primary_pdf_url"] or "",
                "category": "easa_ad",
            },
            text=text,
            claims=[],
            component_patterns=component_patterns,
            failure_patterns=failure_patterns,
            effect_patterns=effect_patterns,
            cause_patterns=cause_patterns,
            relevant_record_ids=relevant_record_ids,
        )

    rows = []
    for row in grouped.values():
        row["effect"] = "; ".join(row.pop("effects"))
        row["cause"] = "; ".join(row.pop("causes"))
        row["evidenceCount"] = len(row["sources"])
        rows.append(row)

    rows.sort(key=lambda row: (_component_sort(row["component"]), -row["evidenceCount"], row["failureMode"]))
    components = [component for component in BASE_COMPONENT_ORDER if any(row["component"] == component for row in rows)]
    components.extend(
        component
        for component in sorted({row["component"] for row in rows})
        if component not in components
    )

    return {
        "system": "Turbofan engine",
        "sourceType": "Supabase papers_raw + knowledge claims + public.easa_ads",
        "recordCount": record_count,
        "relevantRecordCount": len(relevant_record_ids),
        "rowCount": len(rows),
        "components": components,
        "rows": rows,
    }


def _add_record(
    grouped: dict[tuple[str, str], dict[str, Any]],
    *,
    record_id: str,
    source: dict[str, str],
    text: str,
    claims: list[dict[str, Any]],
    component_patterns: list[tuple[Any, str]],
    failure_patterns: list[tuple[Any, str]],
    effect_patterns: list[tuple[Any, str]],
    cause_patterns: list[tuple[Any, str]],
    relevant_record_ids: set[str],
) -> None:
    components = extract(text, component_patterns)
    failure_modes = extract(text, failure_patterns)
    effects = extract(text, effect_patterns)
    causes = extract(text, cause_patterns)

    for claim in claims:
        claim_type = claim.get("claim_type")
        value = " ".join(str(part or "") for part in (claim.get("normalized_value"), claim.get("raw_value"))).lower()
        if claim_type == "component":
            add_unique(components, extract(value, component_patterns) or [_clean_claim_value(claim)])
        elif claim_type == "failure_mode":
            add_unique(failure_modes, extract(value, failure_patterns) or [_clean_claim_value(claim)])
        elif claim_type == "effect":
            add_unique(effects, extract(value, effect_patterns) or [_clean_claim_value(claim)])
        elif claim_type == "cause":
            add_unique(causes, extract(value, cause_patterns) or [_clean_claim_value(claim)])

    components = _dedupe_ordered([_normalize_component(value) for value in components])
    failure_modes = _dedupe_ordered([_normalize_label(value) for value in failure_modes])
    effects = _dedupe_ordered([_normalize_label(value) for value in effects])
    causes = _dedupe_ordered([_normalize_label(value) for value in causes])

    if "Foreign object damage (FOD)" in failure_modes and "Fan / fan blade" not in components:
        components.insert(0, "Fan / fan blade")
    if "Fan blade out" in failure_modes and "Fan / fan blade" not in components:
        components.insert(0, "Fan / fan blade")

    if not components or not failure_modes:
        return

    relevant_record_ids.add(record_id)
    for component in components:
        if component.lower() in {"engine", "turbofan engine", "whole turbine engine"}:
            continue
        for failure_mode in failure_modes:
            if failure_mode.lower() in {"rul degradation", "remaining useful life", "degradation"}:
                continue
            key = (component, failure_mode)
            row = grouped.setdefault(
                key,
                {
                    "component": component,
                    "failureMode": failure_mode,
                    "severity": "",
                    "occurrence": "",
                    "detection": "",
                    "correctiveAction": "",
                    "rpn": "",
                    "effects": [],
                    "causes": [],
                    "sources": [],
                },
            )
            add_unique(row["effects"], effects)
            add_unique(row["causes"], causes)
            if source["title"] and not any(_source_key(source) == _source_key(existing) for existing in row["sources"]):
                row["sources"].append(source)


def _clean_claim_value(claim: dict[str, Any]) -> str:
    return _normalize_label(str(claim.get("normalized_value") or claim.get("raw_value") or ""))


def _normalize_component(value: str) -> str:
    lowered = value.strip().lower()
    if lowered in {"blade"}:
        return "Fan / fan blade"
    if lowered in {"gear"}:
        return "Gearbox / accessory gearbox"
    if lowered in {"pump"}:
        return "Pump"
    if lowered in {"valve"}:
        return "Valve"
    if lowered in {"seal"}:
        return "Seal"
    if lowered in {"sensor"}:
        return "Sensor / instrumentation"
    return _normalize_label(value)


def _normalize_label(value: str) -> str:
    cleaned = " ".join(value.replace("_", " ").split())
    if not cleaned:
        return ""
    if any(char.isupper() for char in cleaned[1:]):
        return cleaned
    return cleaned[:1].upper() + cleaned[1:]


def _dedupe_ordered(values: list[str]) -> list[str]:
    deduped: list[str] = []
    for value in values:
        if value and value not in deduped:
            deduped.append(value)
    return deduped


def _component_sort(component: str) -> tuple[int, str]:
    try:
        return (BASE_COMPONENT_ORDER.index(component), component)
    except ValueError:
        return (len(BASE_COMPONENT_ORDER), component)


def _source_key(source: dict[str, str]) -> tuple[str, str, str]:
    return (source.get("doi", ""), source.get("url", ""), source.get("title", ""))


def main() -> None:
    parser = argparse.ArgumentParser(description="Export Supabase turbofan evidence into frontend FMEA JSON.")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    payload = export_fmea_from_supabase()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"paper-classifier wrote {payload['rowCount']} Supabase FMEA rows to {args.output}")


if __name__ == "__main__":
    main()
