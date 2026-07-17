from __future__ import annotations

from dataclasses import dataclass, field
from enum import StrEnum


class ClaimType(StrEnum):
    COMPONENT = "component"
    FAILURE_MODE = "failure_mode"
    CAUSE = "cause"
    EFFECT = "effect"
    CONTROL = "control"
    CORRECTIVE_ACTION = "corrective_action"
    ANALYSIS_METHOD = "analysis_method"
    APPLICATION = "application"
    OPERATING_CONTEXT = "operating_context"
    DETECTION_METHOD = "detection_method"
    MAINTENANCE_ACTION = "maintenance_action"
    MATERIAL = "material"
    ENVIRONMENT = "environment"


class SupportType(StrEnum):
    DIRECT_SPAN = "direct_span"
    INFERRED_FROM_SPAN = "inferred_from_span"


class RelationshipType(StrEnum):
    HAS_FAILURE_MODE = "has_failure_mode"
    CAUSED_BY = "caused_by"
    HAS_EFFECT = "has_effect"
    MITIGATED_BY = "mitigated_by"
    CORRECTED_BY = "corrected_by"
    DETECTED_BY = "detected_by"
    ANALYSED_BY = "analysed_by"
    HAS_CONTEXT = "has_context"


@dataclass(frozen=True)
class Paper:
    id: str
    doi: str | None
    title: str
    abstract: str | None
    journal: str | None
    year: int | None
    authors: str | None
    url: str | None
    source: str
    cited_by: int | None = None
    openalex_id: str | None = None
    full_text: str | None = None
    full_text_id: str | None = None
    full_text_source_url: str | None = None
    full_text_license: str | None = None
    full_text_sha256: str | None = None


@dataclass(frozen=True)
class EvidenceSpan:
    source_field: str
    text: str
    char_start: int | None
    char_end: int | None
    license_safe: bool = True
    source_record_id: str | None = None


@dataclass(frozen=True)
class EvidenceClaim:
    claim_type: ClaimType
    raw_value: str
    normalized_value: str | None
    support_type: SupportType
    confidence: float
    spans: tuple[EvidenceSpan, ...]
    inference_rationale: str | None = None
    metadata: dict[str, object] = field(default_factory=dict)


@dataclass(frozen=True)
class ClaimRelationship:
    subject_index: int
    relationship_type: RelationshipType
    object_index: int
    support_type: SupportType
    confidence: float
    metadata: dict[str, object] = field(default_factory=dict)


@dataclass(frozen=True)
class ClassificationResult:
    relevance: str
    confidence: float
    claims: tuple[EvidenceClaim, ...]
    relationships: tuple[ClaimRelationship, ...]
    metadata: dict[str, object] = field(default_factory=dict)
