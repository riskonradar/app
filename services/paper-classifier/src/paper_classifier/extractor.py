from __future__ import annotations

import re
from collections.abc import Iterable

from paper_classifier.failure_modes import canonical_failure_mode_label
from paper_classifier.keywords import ALL_TERMS, KeywordTerm
from paper_classifier.models import (
    ClaimRelationship,
    ClaimType,
    ClassificationResult,
    EvidenceClaim,
    EvidenceSpan,
    Paper,
    RelationshipType,
    SupportType,
)

CLASSIFIER_VERSION = "keyword-span-preprocessor-v1"


def classify_paper(paper: Paper) -> ClassificationResult:
    claims = _dedupe_claims(_direct_keyword_claims(paper))
    claims = tuple([*claims, *_inferred_claims(claims)])
    relationships = _relationships(claims)

    relevance_score = _relevance_score(claims)
    relevance = "relevant" if relevance_score >= 0.45 else "possibly_relevant" if claims else "not_relevant"

    return ClassificationResult(
        relevance=relevance,
        confidence=relevance_score,
        claims=claims,
        relationships=relationships,
        metadata={
            "classifier_version": CLASSIFIER_VERSION,
            "extractor": "deterministic keyword/span preprocessor",
            "claim_count": len(claims),
            "relationship_count": len(relationships),
        },
    )


def _direct_keyword_claims(paper: Paper) -> tuple[EvidenceClaim, ...]:
    claims: list[EvidenceClaim] = []
    fields = (("title", paper.title), ("abstract", paper.abstract or ""))
    for term in ALL_TERMS:
        for source_field, value in fields:
            spans = tuple(_find_spans(source_field, value, term.aliases))
            if not spans:
                continue
            normalized_value = term.normalized
            if term.claim_type == ClaimType.FAILURE_MODE:
                normalized_value = canonical_failure_mode_label(term.normalized)
                if not normalized_value:
                    continue
            claims.append(
                EvidenceClaim(
                    claim_type=term.claim_type,
                    raw_value=spans[0].text,
                    normalized_value=normalized_value,
                    support_type=SupportType.DIRECT_SPAN,
                    confidence=_term_confidence(term, source_field),
                    spans=spans,
                    metadata={"matched_aliases": sorted({span.text.lower() for span in spans})},
                )
            )
            break

    claims.extend(_sentence_claims(paper))
    return tuple(claims)


def _sentence_claims(paper: Paper) -> tuple[EvidenceClaim, ...]:
    claims: list[EvidenceClaim] = []
    abstract = paper.abstract or ""
    for sentence in _sentences(abstract):
        lower = sentence.lower()
        if any(marker in lower for marker in ("effect", "resulted in", "leading to", "led to", "caused")):
            if any(marker in lower for marker in ("failure", "loss", "damage", "shutdown", "leakage", "fracture")):
                start = abstract.find(sentence)
                claims.append(
                    EvidenceClaim(
                        claim_type=ClaimType.EFFECT,
                        raw_value=sentence,
                        normalized_value=None,
                        support_type=SupportType.DIRECT_SPAN,
                        confidence=0.55,
                        spans=(EvidenceSpan("abstract", sentence, start if start >= 0 else None, start + len(sentence) if start >= 0 else None),),
                        metadata={"extractor": "effect_sentence_pattern"},
                    )
                )
        if any(marker in lower for marker in ("prevent", "mitigat", "improv", "strengthen", "inspection", "maintenance")):
            start = abstract.find(sentence)
            claims.append(
                EvidenceClaim(
                    claim_type=ClaimType.CONTROL,
                    raw_value=sentence,
                    normalized_value=None,
                    support_type=SupportType.DIRECT_SPAN,
                    confidence=0.5,
                    spans=(EvidenceSpan("abstract", sentence, start if start >= 0 else None, start + len(sentence) if start >= 0 else None),),
                    metadata={"extractor": "control_sentence_pattern"},
                )
            )
    return tuple(claims)


def _inferred_claims(claims: tuple[EvidenceClaim, ...]) -> tuple[EvidenceClaim, ...]:
    normalized = {claim.normalized_value for claim in claims if claim.normalized_value}
    by_type = {claim.claim_type for claim in claims}
    inferred: list[EvidenceClaim] = []

    if "Corrosion / pitting" in normalized and "Fatigue" in normalized:
        spans = tuple(
            span
            for claim in claims
            if claim.normalized_value in {"Corrosion / pitting", "Fatigue"}
            for span in claim.spans[:1]
        )
        inferred.append(
            EvidenceClaim(
                claim_type=ClaimType.FAILURE_MODE,
                raw_value="corrosion fatigue",
                normalized_value=canonical_failure_mode_label("corrosion fatigue"),
                support_type=SupportType.INFERRED_FROM_SPAN,
                confidence=0.62,
                spans=spans,
                inference_rationale="Inferred from direct corrosion and fatigue evidence in the same paper.",
                metadata={"inference_rule": "corrosion_plus_fatigue"},
            )
        )

    if ClaimType.FAILURE_MODE in by_type and "cyclic loading" in normalized:
        spans = tuple(
            span
            for claim in claims
            if claim.claim_type == ClaimType.FAILURE_MODE or claim.normalized_value == "cyclic loading"
            for span in claim.spans[:1]
        )
        inferred.append(
            EvidenceClaim(
                claim_type=ClaimType.CAUSE,
                raw_value="cyclic stress exposure",
                normalized_value="cyclic stress exposure",
                support_type=SupportType.INFERRED_FROM_SPAN,
                confidence=0.58,
                spans=spans,
                inference_rationale="Inferred from cyclic loading and a failure mode appearing in the same source.",
                metadata={"inference_rule": "cyclic_loading_failure_context"},
            )
        )

    return tuple(inferred)


def _relationships(claims: tuple[EvidenceClaim, ...]) -> tuple[ClaimRelationship, ...]:
    first_by_type: dict[ClaimType, int] = {}
    for index, claim in enumerate(claims):
        first_by_type.setdefault(claim.claim_type, index)

    relationships: list[ClaimRelationship] = []
    component_index = first_by_type.get(ClaimType.COMPONENT)
    failure_index = first_by_type.get(ClaimType.FAILURE_MODE)
    if component_index is not None and failure_index is not None:
        relationships.append(
            ClaimRelationship(component_index, RelationshipType.HAS_FAILURE_MODE, failure_index, SupportType.INFERRED_FROM_SPAN, 0.5)
        )

    if failure_index is not None:
        for claim_type, relationship_type in (
            (ClaimType.CAUSE, RelationshipType.CAUSED_BY),
            (ClaimType.EFFECT, RelationshipType.HAS_EFFECT),
            (ClaimType.CONTROL, RelationshipType.MITIGATED_BY),
            (ClaimType.DETECTION_METHOD, RelationshipType.DETECTED_BY),
            (ClaimType.OPERATING_CONTEXT, RelationshipType.HAS_CONTEXT),
            (ClaimType.ENVIRONMENT, RelationshipType.HAS_CONTEXT),
        ):
            object_index = first_by_type.get(claim_type)
            if object_index is not None:
                relationships.append(
                    ClaimRelationship(failure_index, relationship_type, object_index, SupportType.INFERRED_FROM_SPAN, 0.45)
                )
    return tuple(relationships)


def _find_spans(source_field: str, value: str, aliases: Iterable[str]) -> Iterable[EvidenceSpan]:
    for alias in aliases:
        pattern = re.compile(rf"\b{re.escape(alias)}\b", re.IGNORECASE)
        for match in pattern.finditer(value):
            yield EvidenceSpan(source_field, value[match.start() : match.end()], match.start(), match.end())


def _sentences(value: str) -> Iterable[str]:
    for sentence in re.split(r"(?<=[.!?])\s+", value):
        stripped = sentence.strip()
        if 30 <= len(stripped) <= 700:
            yield stripped


def _dedupe_claims(claims: Iterable[EvidenceClaim]) -> tuple[EvidenceClaim, ...]:
    deduped: dict[tuple[str, str, str], EvidenceClaim] = {}
    for claim in claims:
        key = (claim.claim_type.value, claim.normalized_value or claim.raw_value.lower(), claim.support_type.value)
        existing = deduped.get(key)
        if existing is None or claim.confidence > existing.confidence:
            deduped[key] = claim
    return tuple(deduped.values())


def _term_confidence(term: KeywordTerm, source_field: str) -> float:
    base = {
        ClaimType.COMPONENT: 0.72,
        ClaimType.FAILURE_MODE: 0.76,
        ClaimType.CAUSE: 0.64,
        ClaimType.CONTROL: 0.56,
        ClaimType.DETECTION_METHOD: 0.58,
        ClaimType.OPERATING_CONTEXT: 0.58,
        ClaimType.ENVIRONMENT: 0.58,
    }.get(term.claim_type, 0.55)
    return min(base + (0.05 if source_field == "title" else 0), 0.95)


def _relevance_score(claims: tuple[EvidenceClaim, ...]) -> float:
    if not claims:
        return 0.0
    types = {claim.claim_type for claim in claims}
    score = 0.2
    if ClaimType.COMPONENT in types:
        score += 0.2
    if ClaimType.FAILURE_MODE in types:
        score += 0.25
    if ClaimType.CAUSE in types:
        score += 0.12
    if ClaimType.EFFECT in types:
        score += 0.1
    if ClaimType.CONTROL in types or ClaimType.DETECTION_METHOD in types:
        score += 0.08
    return min(score, 0.95)
