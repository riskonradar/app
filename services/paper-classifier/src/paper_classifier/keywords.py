from __future__ import annotations

from dataclasses import dataclass

from paper_classifier.models import ClaimType


@dataclass(frozen=True)
class KeywordTerm:
    normalized: str
    aliases: tuple[str, ...]
    claim_type: ClaimType
    depth: int = 0


# Closed component, failure-mode, analysis-method, and application vocabularies
# are loaded from the corresponding knowledge taxonomy tables at batch time.
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

CORRECTIVE_ACTION_TERMS: tuple[KeywordTerm, ...] = (
    KeywordTerm("replacement", ("replacement", "replaced", "replace the affected"), ClaimType.CORRECTIVE_ACTION),
    KeywordTerm("mandatory modification", ("mandatory modification", "airworthiness directive", "required modification"), ClaimType.CORRECTIVE_ACTION),
    KeywordTerm("repair", ("repair", "repaired", "weld repair"), ClaimType.CORRECTIVE_ACTION),
    KeywordTerm("component removal", ("removal", "remove and replace", "part replacement"), ClaimType.CORRECTIVE_ACTION),
)

HEURISTIC_TERMS: tuple[KeywordTerm, ...] = (
    CAUSE_TERMS
    + CONTROL_TERMS
    + ENVIRONMENT_TERMS
    + CORRECTIVE_ACTION_TERMS
)
