from __future__ import annotations

import argparse
import json
import re
from collections import OrderedDict
from pathlib import Path
from typing import Any


COMPONENT_ORDER = [
    "Engine inlet / intake",
    "Fan / fan blade",
    "Fan case",
    "Gearbox / accessory gearbox",
    "Bearing",
    "Low-pressure compressor",
    "High-pressure compressor",
    "Combustor",
    "High-pressure turbine",
    "Low-pressure turbine",
    "Shaft",
]

COMPONENT_MAP = OrderedDict({
    "engine inlet": "Engine inlet / intake",
    "inlet duct liner": "Engine inlet / intake",
    "duct liner": "Engine inlet / intake",
    "inlet": "Engine inlet / intake",
    "intake": "Engine inlet / intake",
    "fan case": "Fan case",
    "fan casing": "Fan case",
    "fan containment": "Fan case",
    "fan duct": "Fan case",
    "fan blade": "Fan / fan blade",
    "fan blades": "Fan / fan blade",
    "fan rotor": "Fan / fan blade",
    "fan disk": "Fan / fan blade",
    "fan disc": "Fan / fan blade",
    "fan": "Fan / fan blade",
    "gearbox": "Gearbox / accessory gearbox",
    "accessory gearbox": "Gearbox / accessory gearbox",
    "spiral bevel gear": "Gearbox / accessory gearbox",
    "gear": "Gearbox / accessory gearbox",
    "roller bearing": "Bearing",
    "ball bearing": "Bearing",
    "bearing": "Bearing",
    "low pressure compressor": "Low-pressure compressor",
    "low-pressure compressor": "Low-pressure compressor",
    "lpc": "Low-pressure compressor",
    "high pressure compressor": "High-pressure compressor",
    "high-pressure compressor": "High-pressure compressor",
    "hpc": "High-pressure compressor",
    "compressor blade": "High-pressure compressor",
    "compressor": "High-pressure compressor",
    "combustor": "Combustor",
    "combustion chamber": "Combustor",
    "high pressure turbine": "High-pressure turbine",
    "high-pressure turbine": "High-pressure turbine",
    "hpt": "High-pressure turbine",
    "hpt blade": "High-pressure turbine",
    "turbine blade": "High-pressure turbine",
    "turbine": "High-pressure turbine",
    "low pressure turbine": "Low-pressure turbine",
    "low-pressure turbine": "Low-pressure turbine",
    "lpt": "Low-pressure turbine",
    "lpt blade": "Low-pressure turbine",
    "shaft / spool": "Shaft",
    "spool": "Shaft",
    "shaft": "Shaft",
})

FAILURE_MODE_MAP = OrderedDict({
    "low cycle fatigue": "Fatigue",
    "high cycle fatigue": "Fatigue",
    "thermomechanical fatigue": "Fatigue",
    "thermal fatigue": "Fatigue",
    "fretting fatigue": "Fatigue",
    "fatigue": "Fatigue",
    "crack": "Crack / fracture",
    "cracks": "Crack / fracture",
    "cracking": "Crack / fracture",
    "fracture": "Crack / fracture",
    "rupture": "Crack / fracture",
    "burst": "Crack / fracture",
    "breakage": "Crack / fracture",
    "deformation": "Deformation / buckling",
    "buckling": "Deformation / buckling",
    "bending": "Deformation / buckling",
    "imbalance": "Rotor imbalance",
    "unbalance": "Rotor imbalance",
    "flutter": "Blade vibration / flutter",
    "blade flutter": "Blade vibration / flutter",
    "mistuning": "Blade vibration / flutter",
    "aeroelastic": "Blade vibration / flutter",
    "foreign object damage": "Foreign object damage (FOD)",
    "foreign object impact": "Foreign object damage (FOD)",
    "bird strike": "Foreign object damage (FOD)",
    "bird strikes": "Foreign object damage (FOD)",
    "fod": "Foreign object damage (FOD)",
    "ice ingestion": "Foreign object damage (FOD)",
    "sand ingestion": "Foreign object damage (FOD)",
    "flow distortion": "Flow disturbance / distortion",
    "swirl distortion": "Flow disturbance / distortion",
    "flow disturbance": "Flow disturbance / distortion",
    "potential disturbance": "Flow disturbance / distortion",
    "erosion": "Erosion",
    "stall": "Stall / surge",
    "surge": "Stall / surge",
    "creep": "Creep",
    "wear": "Wear / rubbing",
    "rubbing": "Wear / rubbing",
    "fretting": "Wear / rubbing",
    "carbon deposition": "Deposits / blockage",
    "carbon deposit": "Deposits / blockage",
    "coking": "Deposits / blockage",
    "blockage": "Deposits / blockage",
    "flexural vibration": "Flexural deformation / vibration",
    "flexural deformation": "Flexural deformation / vibration",
    "oxidation": "Oxidation",
    "overspeed": "Overspeed",
    "over-speed": "Overspeed",
    "corrosion": "Corrosion / pitting",
    "pitting": "Corrosion / pitting",
    "thermal shock": "Thermal shock",
    "combustion instability": "Combustion instability",
    "leakage": "Leakage",
    "misalignment": "Misalignment",
    "overtemperature": "Overheating / overtemperature",
    "overheating": "Overheating / overtemperature",
    "seizure": "Seizure",
    "spallation": "Spallation",
    "spalling": "Spallation",
})

EFFECT_MAP = OrderedDict({
    "loss of thrust": "Loss of thrust",
    "thrust loss": "Loss of thrust",
    "reduced thrust": "Reduced thrust / performance loss",
    "performance loss": "Reduced thrust / performance loss",
    "engine failure": "Engine failure",
    "engine shutdown": "Engine shutdown",
    "in flight shutdown": "In-flight shutdown",
    "shutdown": "Engine shutdown",
    "surge": "Surge",
    "stall": "Stall / surge",
    "flow disturbance": "Flow disturbance / distortion",
    "flow turbulence": "Flow turbulence / disturbance",
    "vibration": "High vibration",
    "noise": "Abnormal noise",
    "oil debris": "Oil debris",
    "fire": "Fire / overheat hazard",
    "overheat": "Fire / overheat hazard",
    "metallic particles": "Metallic particle generation",
    "downstream components": "Downstream component damage",
})

CAUSE_MAP = OrderedDict({
    "loss of coating": "Loss of protective coating",
    "inadequate oxidation protection": "Inadequate oxidation protection",
    "substrate material aging": "Substrate material aging",
    "under-filling": "Manufacturing under-fill flaw",
    "flaw near surface": "Near-surface manufacturing flaw",
    "fatigue striations": "Progressive fatigue crack growth",
    "fatigue": "Cyclic stress loading",
    "thermal fatigue": "Thermal cycling",
    "cavitation": "Cavitation in fuel pump flow",
    "swirl distortion": "Inlet swirl distortion",
    "bird strike": "Bird ingestion / impact",
    "foreign object": "Foreign object ingestion",
    "fod": "Foreign object ingestion",
    "carbon deposit": "Carbon deposition",
    "coking": "Fuel thermal coking",
    "oil starvation": "Oil starvation",
    "oil contamination": "Oil contamination",
    "misalignment": "Rotor/shaft misalignment",
    "imbalance": "Rotor imbalance",
    "overheating": "Excess thermal loading",
    "oxidation": "High-temperature oxidation",
    "creep": "High-temperature creep exposure",
    "corrosion": "Corrosive environment",
    "erosion": "Particle/fluid erosion",
    "wear": "Contact wear",
    "rubbing": "Rotor-stator rubbing",
    "combustion instability": "Unstable combustion dynamics",
})


def parse_ris(path: Path) -> list[dict[str, list[str]]]:
    records: list[dict[str, list[str]]] = []
    current: dict[str, list[str]] = {}
    for raw_line in path.read_text(encoding="utf-8", errors="ignore").splitlines():
        if raw_line.startswith("TY  -"):
            current = {"TY": [raw_line[6:].strip()]}
        elif raw_line.startswith("ER  -"):
            if current:
                records.append(current)
            current = {}
        else:
            match = re.match(r"^([A-Z0-9]{2})  - (.*)$", raw_line)
            if match:
                tag, value = match.groups()
                current.setdefault(tag, []).append(value.strip())
    return records


def patterns(mapping: OrderedDict[str, str]) -> list[tuple[re.Pattern[str], str]]:
    out: list[tuple[re.Pattern[str], str]] = []
    for raw, normalized in mapping.items():
        expr = re.escape(raw.lower()).replace(r"\ ", r"[\s\-]+")
        out.append((re.compile(r"(?<![a-z0-9])" + expr + r"(?![a-z0-9])", re.I), normalized))
    return out


def extract(text: str, compiled: list[tuple[re.Pattern[str], str]]) -> list[str]:
    found: list[str] = []
    for pattern, label in compiled:
        if pattern.search(text) and label not in found:
            found.append(label)
    return found


def source(record: dict[str, list[str]]) -> dict[str, str]:
    return {
        "title": " ".join(record.get("TI", [])).strip(),
        "year": (record.get("PY", [""])[0] or "")[:4],
        "doi": record.get("DO", [""])[0] if record.get("DO") else "",
        "url": record.get("UR", [""])[0] if record.get("UR") else "",
    }


def add_unique(target: list[str], values: list[str]) -> None:
    for value in values:
        if value and value not in target:
            target.append(value)


def classify_ris(path: Path) -> dict[str, Any]:
    component_patterns = patterns(COMPONENT_MAP)
    failure_patterns = patterns(FAILURE_MODE_MAP)
    effect_patterns = patterns(EFFECT_MAP)
    cause_patterns = patterns(CAUSE_MAP)
    grouped: dict[tuple[str, str], dict[str, Any]] = {}
    records = parse_ris(path)

    for record in records:
        title = " ".join(record.get("TI", []))
        abstract = " ".join(record.get("AB", []))
        keywords = " ".join(record.get("KW", []))
        text = " ".join([title, abstract, keywords]).lower()
        components = [c for c in extract(text, component_patterns) if c in COMPONENT_ORDER]
        if "Foreign object damage (FOD)" in extract(text, failure_patterns) and "Fan / fan blade" not in components:
            components.insert(0, "Fan / fan blade")
        components = sorted(set(components), key=COMPONENT_ORDER.index)
        failure_modes = extract(text, failure_patterns)
        effects = extract(text, effect_patterns)
        causes = extract(text, cause_patterns)
        if not components or not failure_modes:
            continue
        paper = source(record)
        for component in components:
            for failure_mode in failure_modes:
                key = (component, failure_mode)
                row = grouped.setdefault(key, {
                    "component": component,
                    "failureMode": failure_mode,
                    "effects": [],
                    "causes": [],
                    "severity": "",
                    "occurrence": "",
                    "detection": "",
                    "correctiveAction": "",
                    "rpn": "",
                    "sources": [],
                })
                add_unique(row["effects"], effects)
                add_unique(row["causes"], causes)
                if paper["title"] and paper not in row["sources"]:
                    row["sources"].append(paper)

    rows = []
    for row in grouped.values():
        row["effect"] = "; ".join(row.pop("effects"))
        row["cause"] = "; ".join(row.pop("causes"))
        row["evidenceCount"] = len(row["sources"])
        rows.append(row)
    rows.sort(key=lambda r: (COMPONENT_ORDER.index(r["component"]), -r["evidenceCount"], r["failureMode"]))

    return {
        "system": "Turbofan engine",
        "sourceType": "Zotero RIS export classified by paper-classifier",
        "recordCount": len(records),
        "rowCount": len(rows),
        "components": [component for component in COMPONENT_ORDER if any(r["component"] == component for r in rows)],
        "rows": rows,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Classify RIS papers into FMEA knowledge rows.")
    parser.add_argument("ris", type=Path)
    parser.add_argument("-o", "--output", type=Path, required=True)
    args = parser.parse_args()
    payload = classify_ris(args.ris)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"Wrote {payload['rowCount']} FMEA classifier rows to {args.output}")


if __name__ == "__main__":
    main()
