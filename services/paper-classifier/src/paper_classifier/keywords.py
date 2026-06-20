from __future__ import annotations

from dataclasses import dataclass

from paper_classifier.models import ClaimType


@dataclass(frozen=True)
class KeywordTerm:
    normalized: str
    aliases: tuple[str, ...]
    claim_type: ClaimType


COMPONENT_TERMS: tuple[KeywordTerm, ...] = (
    KeywordTerm("bearing", ("bearing", "bearings", "roller bearing", "ball bearing"), ClaimType.COMPONENT),
    KeywordTerm("bolt", ("bolt", "bolts", "fastening bolt", "structural bolt"), ClaimType.COMPONENT),
    KeywordTerm("gear", ("gear", "gears", "gearbox", "gear tooth", "tooth"), ClaimType.COMPONENT),
    KeywordTerm("pump", ("pump", "pumps", "centrifugal pump"), ClaimType.COMPONENT),
    KeywordTerm("seal", ("seal", "seals", "mechanical seal", "gasket"), ClaimType.COMPONENT),
    KeywordTerm("shaft", ("shaft", "shafts", "rotor shaft", "drive shaft"), ClaimType.COMPONENT),
    KeywordTerm("valve", ("valve", "valves", "check valve", "control valve"), ClaimType.COMPONENT),
    KeywordTerm("sensor", ("sensor", "sensors", "temperature sensor", "pressure sensor"), ClaimType.COMPONENT),
    KeywordTerm("spring", ("spring", "springs"), ClaimType.COMPONENT),
    KeywordTerm("weld", ("weld", "welds", "welded joint", "weld joint"), ClaimType.COMPONENT),
    KeywordTerm("pipe", ("pipe", "pipes", "pipeline", "tube", "tubing"), ClaimType.COMPONENT),
    KeywordTerm("battery", ("battery", "cell", "lithium-ion cell", "module"), ClaimType.COMPONENT),
    KeywordTerm("converter", ("converter", "power converter", "inverter"), ClaimType.COMPONENT),
    KeywordTerm("blade", ("blade", "turbine blade", "fan blade"), ClaimType.COMPONENT),
)

FAILURE_TERMS: tuple[KeywordTerm, ...] = (
    KeywordTerm("fatigue failure", ("fatigue failure", "fatigue fracture", "fatigue crack", "fatigue cracking"), ClaimType.FAILURE_MODE),
    KeywordTerm("fracture", ("fracture", "fractured", "brittle fracture", "ductile fracture"), ClaimType.FAILURE_MODE),
    KeywordTerm("corrosion", ("corrosion", "corroded", "pitting corrosion", "stress corrosion"), ClaimType.FAILURE_MODE),
    KeywordTerm("wear", ("wear", "abrasive wear", "adhesive wear", "fretting wear"), ClaimType.FAILURE_MODE),
    KeywordTerm("cracking", ("cracking", "crack initiation", "crack propagation", "cracks"), ClaimType.FAILURE_MODE),
    KeywordTerm("delamination", ("delamination", "debonding", "bond failure"), ClaimType.FAILURE_MODE),
    KeywordTerm("overheating", ("overheating", "thermal runaway", "thermal fatigue"), ClaimType.FAILURE_MODE),
    KeywordTerm("leakage", ("leakage", "leak", "fluid leakage"), ClaimType.FAILURE_MODE),
    KeywordTerm("buckling", ("buckling", "collapse"), ClaimType.FAILURE_MODE),
    KeywordTerm("spalling", ("spalling", "pitting", "surface pitting"), ClaimType.FAILURE_MODE),
)

CAUSE_TERMS: tuple[KeywordTerm, ...] = (
    KeywordTerm("cyclic loading", ("cyclic loading", "repeated loading", "alternating load", "dynamic load"), ClaimType.CAUSE),
    KeywordTerm("overload", ("overload", "excessive load", "overloading", "high load"), ClaimType.CAUSE),
    KeywordTerm("misalignment", ("misalignment", "misaligned"), ClaimType.CAUSE),
    KeywordTerm("poor lubrication", ("poor lubrication", "insufficient lubrication", "lubrication failure"), ClaimType.CAUSE),
    KeywordTerm("manufacturing defect", ("manufacturing defect", "material defect", "inclusion", "defect"), ClaimType.CAUSE),
    KeywordTerm("hydrogen embrittlement", ("hydrogen embrittlement", "embrittlement"), ClaimType.CAUSE),
    KeywordTerm("corrosive environment", ("corrosive environment", "marine environment", "chloride", "salt spray"), ClaimType.CAUSE),
    KeywordTerm("improper heat treatment", ("improper heat treatment", "incorrect heat treatment"), ClaimType.CAUSE),
)

CONTROL_TERMS: tuple[KeywordTerm, ...] = (
    KeywordTerm("inspection", ("inspection", "inspect", "monitoring", "condition monitoring"), ClaimType.CONTROL),
    KeywordTerm("maintenance", ("maintenance", "preventive maintenance", "predictive maintenance"), ClaimType.CONTROL),
    KeywordTerm("surface protection", ("surface protection", "coating", "galvanizing", "corrosion protection"), ClaimType.CONTROL),
    KeywordTerm("lubrication control", ("lubrication", "lubricant", "lubricating"), ClaimType.CONTROL),
    KeywordTerm("design improvement", ("design improvement", "redesign", "optimized design", "strengthening"), ClaimType.CONTROL),
    KeywordTerm("non-destructive testing", ("non-destructive testing", "nondestructive testing", "ndt", "ultrasonic testing"), ClaimType.DETECTION_METHOD),
)

ENVIRONMENT_TERMS: tuple[KeywordTerm, ...] = (
    KeywordTerm("marine environment", ("marine environment", "offshore", "seawater", "salt spray"), ClaimType.ENVIRONMENT),
    KeywordTerm("high temperature", ("high temperature", "elevated temperature", "thermal environment"), ClaimType.ENVIRONMENT),
    KeywordTerm("dynamic loading", ("dynamic load", "impact load", "vibration", "cyclic load"), ClaimType.OPERATING_CONTEXT),
    KeywordTerm("mining environment", ("mining", "deep mining", "roadway"), ClaimType.OPERATING_CONTEXT),
)

ALL_TERMS: tuple[KeywordTerm, ...] = (
    COMPONENT_TERMS
    + FAILURE_TERMS
    + CAUSE_TERMS
    + CONTROL_TERMS
    + ENVIRONMENT_TERMS
)
