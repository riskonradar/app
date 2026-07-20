from __future__ import annotations

import re
from collections.abc import Iterable
from dataclasses import dataclass

from paper_classifier.keywords import HEURISTIC_TERMS, KeywordTerm
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

CLASSIFIER_VERSION = "keyword-taxonomy-preprocessor-v2"


@dataclass(frozen=True)
class _TermMatch:
    term: KeywordTerm
    source_field: str
    source_record_id: str | None
    text: str
    start: int
    end: int


def classify_paper(
    paper: Paper,
    taxonomy_terms: Iterable[KeywordTerm] = (),
) -> ClassificationResult:
    taxonomy_terms = tuple(taxonomy_terms)
    claims = _dedupe_claims(_direct_keyword_claims(paper, taxonomy_terms))
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
            "input_source": "full_text" if paper.full_text else "title_abstract",
            "full_text_id": paper.full_text_id,
            "full_text_sha256": paper.full_text_sha256,
            "taxonomy_term_count": len(taxonomy_terms),
        },
    )


def _direct_keyword_claims(
    paper: Paper,
    taxonomy_terms: tuple[KeywordTerm, ...],
) -> tuple[EvidenceClaim, ...]:
    claims = [
        *_taxonomy_keyword_claims(paper, taxonomy_terms),
        *_heuristic_keyword_claims(paper),
    ]
    claims.extend(_sentence_claims(paper))
    return tuple(claims)


def _taxonomy_keyword_claims(
    paper: Paper,
    taxonomy_terms: tuple[KeywordTerm, ...],
) -> tuple[EvidenceClaim, ...]:
    grouped: dict[tuple[ClaimType, str], list[_TermMatch]] = {}
    selected_field: dict[tuple[ClaimType, str], str] = {}

    for source_field, value, source_record_id in _source_fields(paper):
        matches = _select_non_overlapping(
            _find_term_matches(
                source_field,
                value,
                source_record_id,
                taxonomy_terms,
            )
        )
        for match in matches:
            key = (match.term.claim_type, match.term.normalized.casefold())
            first_field = selected_field.setdefault(key, source_field)
            if first_field == source_field:
                grouped.setdefault(key, []).append(match)

    claims: list[EvidenceClaim] = []
    for matches in grouped.values():
        term = matches[0].term
        spans = tuple(_span_from_match(match) for match in matches)
        claims.append(
            EvidenceClaim(
                claim_type=term.claim_type,
                raw_value=spans[0].text,
                normalized_value=term.normalized,
                support_type=SupportType.DIRECT_SPAN,
                confidence=_term_confidence(term, matches[0].source_field),
                spans=spans,
                metadata={
                    "matched_aliases": sorted({span.text.casefold() for span in spans}),
                    "vocabulary_source": "knowledge_taxonomy",
                },
            )
        )
    return tuple(claims)


def _heuristic_keyword_claims(paper: Paper) -> tuple[EvidenceClaim, ...]:
    grouped: dict[tuple[ClaimType, str], list[_TermMatch]] = {}
    selected_field: dict[tuple[ClaimType, str], str] = {}

    for source_field, value, source_record_id in _source_fields(paper):
        matches = _select_non_overlapping(
            _find_term_matches(
                source_field,
                value,
                source_record_id,
                HEURISTIC_TERMS,
            )
        )
        for match in matches:
            # Open-ended fields are evidence phrases, not a closed vocabulary.
            # Preserve the source phrase instead of replacing it with the broad
            # heuristic bucket used to find it.
            key = (match.term.claim_type, match.text.casefold())
            first_field = selected_field.setdefault(key, source_field)
            if first_field == source_field:
                grouped.setdefault(key, []).append(match)

    claims: list[EvidenceClaim] = []
    for matches in grouped.values():
        term = matches[0].term
        spans = tuple(_span_from_match(match) for match in matches)
        claims.append(
            EvidenceClaim(
                claim_type=term.claim_type,
                raw_value=spans[0].text,
                normalized_value=spans[0].text,
                support_type=SupportType.DIRECT_SPAN,
                confidence=_term_confidence(term, matches[0].source_field),
                spans=spans,
                metadata={
                    "heuristic_group": term.normalized,
                    "matched_aliases": sorted({span.text.casefold() for span in spans}),
                },
            )
        )
    return tuple(claims)


def _source_fields(
    paper: Paper,
) -> tuple[tuple[str, str, str | None], ...]:
    return (
        ("title", paper.title, None),
        ("abstract", paper.abstract or "", None),
        ("full_text", paper.full_text or "", paper.full_text_id),
    )


def _find_term_matches(
    source_field: str,
    value: str,
    source_record_id: str | None,
    terms: Iterable[KeywordTerm],
) -> tuple[_TermMatch, ...]:
    matches: list[_TermMatch] = []
    seen: set[tuple[ClaimType, str, int, int]] = set()
    for term in sorted(
        terms,
        key=lambda item: (item.claim_type.value, item.normalized.casefold()),
    ):
        aliases = {term.normalized, *term.aliases}
        for alias in sorted(aliases, key=lambda item: (-len(item), item.casefold())):
            if not alias.strip():
                continue
            pattern = re.compile(
                rf"(?<!\w){re.escape(alias)}(?!\w)",
                re.IGNORECASE,
            )
            for match in pattern.finditer(value):
                key = (
                    term.claim_type,
                    term.normalized.casefold(),
                    match.start(),
                    match.end(),
                )
                if key in seen:
                    continue
                seen.add(key)
                matches.append(
                    _TermMatch(
                        term=term,
                        source_field=source_field,
                        source_record_id=source_record_id,
                        text=value[match.start() : match.end()],
                        start=match.start(),
                        end=match.end(),
                    )
                )
    return tuple(matches)


def _select_non_overlapping(
    matches: Iterable[_TermMatch],
) -> tuple[_TermMatch, ...]:
    by_type: dict[ClaimType, list[_TermMatch]] = {}
    for match in matches:
        by_type.setdefault(match.term.claim_type, []).append(match)

    accepted: list[_TermMatch] = []
    for claim_type in sorted(by_type, key=lambda item: item.value):
        selected: list[_TermMatch] = []
        candidates = sorted(
            by_type[claim_type],
            key=lambda item: (
                -(item.end - item.start),
                -item.term.depth,
                -len(item.term.normalized),
                item.start,
                item.end,
                item.term.normalized.casefold(),
                item.text.casefold(),
            ),
        )
        for candidate in candidates:
            if any(
                candidate.start < existing.end and existing.start < candidate.end
                for existing in selected
            ):
                continue
            selected.append(candidate)
        accepted.extend(selected)
    return tuple(
        sorted(
            accepted,
            key=lambda item: (
                item.start,
                item.end,
                item.term.claim_type.value,
                item.term.normalized.casefold(),
            ),
        )
    )


def _span_from_match(match: _TermMatch) -> EvidenceSpan:
    return EvidenceSpan(
        match.source_field,
        match.text,
        match.start,
        match.end,
        source_record_id=match.source_record_id,
    )


def _sentence_claims(paper: Paper) -> tuple[EvidenceClaim, ...]:
    claims: list[EvidenceClaim] = []
    for source_field, source_text, source_record_id in (
        ("abstract", paper.abstract or "", None),
        ("full_text", paper.full_text or "", paper.full_text_id),
    ):
        for sentence in _sentences(source_text):
            lower = sentence.lower()
            if any(marker in lower for marker in ("effect", "resulted in", "leading to", "led to", "caused")):
                if any(marker in lower for marker in ("failure", "loss", "damage", "shutdown", "leakage", "fracture")):
                    start = source_text.find(sentence)
                    claims.append(
                        EvidenceClaim(
                            claim_type=ClaimType.EFFECT,
                            raw_value=sentence,
                            normalized_value=None,
                            support_type=SupportType.DIRECT_SPAN,
                            confidence=0.55,
                            spans=(EvidenceSpan(source_field, sentence, start if start >= 0 else None, start + len(sentence) if start >= 0 else None, source_record_id=source_record_id),),
                            metadata={"extractor": "effect_sentence_pattern"},
                        )
                    )
            if any(marker in lower for marker in ("prevent", "mitigat", "improv", "strengthen", "inspection", "maintenance")):
                start = source_text.find(sentence)
                claims.append(
                    EvidenceClaim(
                        claim_type=ClaimType.CONTROL,
                        raw_value=sentence,
                        normalized_value=None,
                        support_type=SupportType.DIRECT_SPAN,
                        confidence=0.5,
                        spans=(EvidenceSpan(source_field, sentence, start if start >= 0 else None, start + len(sentence) if start >= 0 else None, source_record_id=source_record_id),),
                        metadata={"extractor": "control_sentence_pattern"},
                    )
                )
    return tuple(claims)


def _inferred_claims(claims: tuple[EvidenceClaim, ...]) -> tuple[EvidenceClaim, ...]:
    normalized = {
        claim.normalized_value.casefold()
        for claim in claims
        if claim.normalized_value
    }
    by_type = {claim.claim_type for claim in claims}
    inferred: list[EvidenceClaim] = []

    has_direct_corrosion_fatigue = any(
        claim.claim_type == ClaimType.FAILURE_MODE
        and claim.normalized_value
        and "corrosion" in claim.normalized_value.casefold()
        and "fatigue" in claim.normalized_value.casefold()
        for claim in claims
    )
    if (
        any("corrosion" in value for value in normalized)
        and any("fatigue" in value for value in normalized)
        and not has_direct_corrosion_fatigue
    ):
        spans = tuple(
            span
            for claim in claims
            if claim.normalized_value
            and any(
                marker in claim.normalized_value.casefold()
                for marker in ("corrosion", "fatigue")
            )
            for span in claim.spans[:1]
        )
        inferred.append(
            EvidenceClaim(
                claim_type=ClaimType.FAILURE_MODE,
                raw_value="corrosion fatigue",
                normalized_value="corrosion fatigue",
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
            if claim.claim_type == ClaimType.FAILURE_MODE
            or (
                claim.normalized_value
                and claim.normalized_value.casefold() == "cyclic loading"
            )
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


def _sentences(value: str) -> Iterable[str]:
    for sentence in re.split(r"(?<=[.!?])\s+", value):
        stripped = sentence.strip()
        if 30 <= len(stripped) <= 700:
            yield stripped


def _dedupe_claims(claims: Iterable[EvidenceClaim]) -> tuple[EvidenceClaim, ...]:
    deduped: dict[tuple[str, str, str], EvidenceClaim] = {}
    for claim in claims:
        key = (
            claim.claim_type.value,
            (claim.normalized_value or claim.raw_value).casefold(),
            claim.support_type.value,
        )
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
