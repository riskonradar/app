from __future__ import annotations

import re
from collections import OrderedDict


DROP_AS_FAILURE_MODE = "DROP_AS_FAILURE_MODE"

FAILURE_MODE_CANONICAL_LABELS = OrderedDict(
    {
        # Crack / fracture family
        "cracking": "Crack / fracture",
        "crack": "Crack / fracture",
        "cracks": "Crack / fracture",
        "fracture": "Crack / fracture",
        "rupture": "Crack / fracture",
        "burst / rupture": "Crack / fracture",
        "burst": "Crack / fracture",
        "creep rupture": "Crack / fracture",
        "creep rupture / fracture": "Crack / fracture",
        "breakage": "Crack / fracture",
        # Fatigue family
        "low-cycle fatigue (lcf)": "Fatigue",
        "low cycle fatigue": "Fatigue",
        "lcf": "Fatigue",
        "high-cycle fatigue (hcf)": "Fatigue",
        "high cycle fatigue": "Fatigue",
        "hcf": "Fatigue",
        "very-high-cycle fatigue (vhcf)": "Fatigue",
        "very high cycle fatigue": "Fatigue",
        "vhcf": "Fatigue",
        "thermo-mechanical fatigue (tmf)": "Fatigue",
        "thermo-mechanical fatigue": "Fatigue",
        "thermomechanical fatigue": "Fatigue",
        "tmf": "Fatigue",
        "thermal fatigue": "Fatigue",
        "fretting fatigue": "Fatigue",
        "dwell fatigue": "Fatigue",
        "corrosion fatigue": "Fatigue",
        "fatigue failure": "Fatigue",
        "fatigue crack": "Fatigue",
        "fatigue life": "Fatigue",
        "fatigue": "Fatigue",
        # FOD / impact / ingestion family
        "bird strike": "Foreign object damage (FOD)",
        "impact damage": "Foreign object damage (FOD)",
        "ingestion damage": "Foreign object damage (FOD)",
        "ice ingestion": "Foreign object damage (FOD)",
        "particle/sand ingestion": "Foreign object damage (FOD)",
        "particle ingestion": "Foreign object damage (FOD)",
        "sand ingestion": "Foreign object damage (FOD)",
        "foreign object damage": "Foreign object damage (FOD)",
        "foreign object impact": "Foreign object damage (FOD)",
        "fod": "Foreign object damage (FOD)",
        # Flow/aero family
        "compressor stall / surge": "Stall / surge",
        "compressor stall": "Stall / surge",
        "rotating stall": "Stall / surge",
        "surge": "Stall / surge",
        "stall": "Stall / surge",
        "flow turbulence / disturbance": "Flow disturbance / distortion",
        "flow turbulence": "Flow disturbance / distortion",
        "flow disturbance": "Flow disturbance / distortion",
        "flow distortion": "Flow disturbance / distortion",
        "inlet/potential-flow disturbance": "Flow disturbance / distortion",
        "potential-flow disturbance": "Flow disturbance / distortion",
        "potential flow disturbance": "Flow disturbance / distortion",
        "flow instability": "Flow disturbance / distortion",
        "swirl distortion": "Flow disturbance / distortion",
        # Flutter / vibration / mistuning family.
        "stall flutter": "Blade vibration / flutter",
        "blade flexural vibration": "Blade vibration / flutter",
        "blade/rotor flutter": "Blade vibration / flutter",
        "blade flutter": "Blade vibration / flutter",
        "rotor flutter": "Blade vibration / flutter",
        "blade/rotor vibration": "Blade vibration / flutter",
        "aeroelastic instability": "Blade vibration / flutter",
        "aeroelastic": "Blade vibration / flutter",
        "blade vibration/flutter": "Blade vibration / flutter",
        "blade mistuning": "Blade vibration / flutter",
        "blade mistuning / aeroelasticity": "Blade vibration / flutter",
        "flutter": "Blade vibration / flutter",
        "mistuning": "Blade vibration / flutter",
        # Deformation family
        "bending deformation": "Deformation / buckling",
        "flexural deformation/vibration": "Deformation / buckling",
        "flexural deformation": "Deformation / buckling",
        "flexural vibration": "Deformation / buckling",
        "deformation": "Deformation / buckling",
        "buckling": "Deformation / buckling",
        "bulging": "Deformation / buckling",
        # Wear/rub/scuff family
        "bearing wear": "Wear / rubbing",
        "abrasive wear": "Wear / rubbing",
        "fretting wear": "Wear / rubbing",
        "rubbing / tip rub": "Wear / rubbing",
        "tip rub": "Wear / rubbing",
        "wear/rubbing": "Wear / rubbing",
        "wear": "Wear / rubbing",
        "rubbing": "Wear / rubbing",
        "scuffing": "Wear / rubbing",
        "scuff": "Wear / rubbing",
        # Corrosion/rust/pitting family
        "corrosion/rusting": "Corrosion / pitting",
        "corrosion": "Corrosion / pitting",
        "rusting": "Corrosion / pitting",
        "rustiness": "Corrosion / pitting",
        "hot corrosion": "Corrosion / pitting",
        "pitting": "Corrosion / pitting",
        # Deposits / blockage / coking family
        "fuel coking / deposits": "Deposits / blockage",
        "deposits / fouling": "Deposits / blockage",
        "carbon deposition/deposits": "Deposits / blockage",
        "carbon deposition / deposits": "Deposits / blockage",
        "carbon deposition": "Deposits / blockage",
        "carbon deposit": "Deposits / blockage",
        "coking": "Deposits / blockage",
        "clogging / blockage": "Deposits / blockage",
        "clogging": "Deposits / blockage",
        "blockage": "Deposits / blockage",
        "blocked": "Deposits / blockage",
        # Leakage family
        "oil leakage": "Leakage",
        "oil leak": "Leakage",
        "fuel leakage": "Leakage",
        "fuel leak": "Leakage",
        "leakage": "Leakage",
        "leak": "Leakage",
        # Thermal family
        "overheating / overtemperature": "Overheating / overtemperature",
        "overheating/overtemperature": "Overheating / overtemperature",
        "overtemperature": "Overheating / overtemperature",
        "overheating": "Overheating / overtemperature",
        "burn-through": "Burn-through",
        "burned-through": "Burn-through",
        # Bearing terms
        "bearing fault": "Bearing fault",
        "bearing faults": "Bearing fault",
        "bearing defect": "Bearing fault",
        "ball-bearing faults": "Bearing fault",
        "ball bearing faults": "Bearing fault",
        "bearing spallation": "Spallation",
        "thermal barrier coating spallation": "Spallation",
        "bearing seizure": "Seizure",
        # Keep these as distinct physical mechanisms
        "creep": "Creep",
        "erosion": "Erosion",
        "oxidation": "Oxidation",
        "spallation": "Spallation",
        "spalling": "Spallation",
        "delamination": "Delamination",
        "debonding": "Debonding",
        "coating failure": "Coating failure",
        "thermal shock": "Thermal shock",
        "combustion instability": "Combustion instability",
        "rotor imbalance": "Rotor imbalance",
        "imbalance": "Rotor imbalance",
        "misalignment": "Misalignment",
        "overspeed": "Overspeed",
        "over-speed": "Overspeed",
        "seizure": "Seizure",
        # Effects/symptoms/detection indicators, not failure modes.
        "noise / acoustic issue": DROP_AS_FAILURE_MODE,
        "fan noise / acoustic issue": DROP_AS_FAILURE_MODE,
        "acoustic/noise propagation issue": DROP_AS_FAILURE_MODE,
        "rotor/engine vibration": DROP_AS_FAILURE_MODE,
        "high vibration": DROP_AS_FAILURE_MODE,
    }
)


_CANONICAL_PATTERNS = tuple(
    (
        re.compile(r"(?<![a-z0-9])" + re.escape(alias).replace(r"\ ", r"[\s\-]+") + r"(?![a-z0-9])", re.I),
        label,
    )
    for alias, label in sorted(FAILURE_MODE_CANONICAL_LABELS.items(), key=lambda item: len(item[0]), reverse=True)
)


def canonical_failure_mode_label(value: str | None) -> str | None:
    cleaned = _normalize_text(value)
    if not cleaned:
        return None
    for pattern, label in _CANONICAL_PATTERNS:
        if pattern.search(cleaned):
            return None if label == DROP_AS_FAILURE_MODE else label
    return cleaned


def _normalize_text(value: str | None) -> str:
    if not value:
        return ""
    return " ".join(value.replace("_", " ").split())
