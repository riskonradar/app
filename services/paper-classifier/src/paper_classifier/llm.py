from __future__ import annotations

import json
import os
import re
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any

from paper_classifier.failure_modes import canonical_failure_mode_label
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

LLM_CLASSIFIER_VERSION = "llm-extractor-v3"


@dataclass(frozen=True)
class LlmConfig:
    provider: str
    model: str
    api_key: str


class LlmExtractorError(RuntimeError):
    pass


def load_llm_config() -> LlmConfig | None:
    provider = os.environ.get("LLM_PROVIDER", "none").strip().lower()
    if provider in {"", "none", "off"}:
        return None

    if provider == "gemini":
        api_key = os.environ.get("GEMINI_API_KEY")
        model = os.environ.get("GEMINI_MODEL", "gemini-2.5-flash-lite")
    elif provider == "groq":
        api_key = os.environ.get("GROQ_API_KEY")
        model = os.environ.get("GROQ_MODEL", "llama-3.3-70b-versatile")
    elif provider == "ollama":
        api_key = "ollama"  # no key needed, but field is required
        model = os.environ.get("OLLAMA_MODEL", "llama3.1:8b")
    elif provider == "openai":
        api_key = os.environ.get("OPENAI_API_KEY")
        model = os.environ.get("OPENAI_MODEL", "gpt-5.4-nano")
    elif provider == "anthropic":
        api_key = os.environ.get("ANTHROPIC_API_KEY")
        model = os.environ.get("ANTHROPIC_MODEL", "claude-haiku-4-5")
    else:
        raise LlmExtractorError(f"Unsupported LLM_PROVIDER: {provider}")

    if not api_key:
        raise LlmExtractorError(f"Missing API key for LLM_PROVIDER={provider}")
    return LlmConfig(provider=provider, model=model, api_key=api_key)


def extract_with_llm(paper: Paper, config: LlmConfig, retries: int = 3) -> ClassificationResult:
    import time
    prompt = _prompt_for(paper)
    last_error: LlmExtractorError | None = None
    for attempt in range(retries):
        try:
            if config.provider == "gemini":
                raw_text = _call_gemini(prompt, config)
            elif config.provider == "groq":
                raw_text = _call_groq(prompt, config)
            elif config.provider == "ollama":
                raw_text = _call_ollama(prompt, config)
            elif config.provider == "openai":
                raw_text = _call_openai(prompt, config)
            elif config.provider == "anthropic":
                raw_text = _call_anthropic(prompt, config)
            else:
                raise LlmExtractorError(f"Unsupported LLM_PROVIDER: {config.provider}")
            payload = _parse_json_object(raw_text)
            return _result_from_payload(paper, payload, config)
        except LlmExtractorError as exc:
            last_error = exc
            if attempt < retries - 1:
                wait = 10 * (2 ** attempt)  # 10s, 20s, 40s
                print(f"  LLM attempt {attempt + 1} failed, retrying in {wait}s: {exc}")
                time.sleep(wait)
    raise last_error


def _prompt_for(paper: Paper) -> str:
    return f"""
You extract reliability engineering evidence for an evidence-backed FMEA product.

Return only valid JSON with this shape:
{{
  "relevance": "relevant" | "possibly_relevant" | "not_relevant",
  "confidence": 0.0,
  "claims": [
    {{
      "claim_type": "component" | "failure_mode" | "cause" | "effect" | "control" | "corrective_action" | "analysis_method" | "application" | "operating_context" | "detection_method" | "maintenance_action" | "material" | "environment",
      "raw_value": "short extracted or inferred phrase",
      "normalized_value": "canonical phrase or null",
      "support_type": "direct_span" | "inferred_from_span",
      "confidence": 0.0,
      "source_field": "title" | "abstract",
      "evidence_text": "exact quote from source_field for direct claims; supporting quote for inferred claims",
      "inference_rationale": "required only for inferred_from_span"
    }}
  ],
  "relationships": [
    {{
      "subject_claim_index": 0,
      "relationship_type": "has_failure_mode" | "caused_by" | "has_effect" | "mitigated_by" | "detected_by" | "has_context" | "corrected_by" | "analysed_by",
      "object_claim_index": 1,
      "support_type": "direct_span" | "inferred_from_span",
      "confidence": 0.0,
      "relationship_evidence_text": "exact quote from title or abstract supporting this relationship",
      "inference_rationale": "required only for inferred_from_span"
    }}
  ]
}}

Claim type definitions:
- component: a physical part or subsystem (bearing, blade, gearbox, valve, seal)
- failure_mode: how something fails (fatigue fracture, corrosion, wear, delamination)
- cause: root or contributing cause of the failure (cyclic loading, poor lubrication, manufacturing defect)
- effect: consequence of failure (engine shutdown, structural collapse, oil loss, fire)
- control: preventive measure or design control (inspection interval, protective coating, redesign)
- corrective_action: reactive fix applied after a failure or unsafe condition was confirmed (replacement of affected components, mandatory modification, issued airworthiness directive)
- analysis_method: how the failure was investigated (finite element analysis, scanning electron microscopy, probabilistic fatigue assessment, machine learning, experimental testing, simulation, analytical model, fracture mechanics)
- application: operating industry or domain (commercial aviation, wind energy, oil and gas, automotive, nuclear, marine, mining)
- operating_context: specific operating conditions (high temperature, cyclic loading, offshore environment, turbofan engine at cruise)
- detection_method: how the failure was detected in service (visual inspection, vibration monitoring, ultrasonic testing, borescope)
- maintenance_action: routine scheduled maintenance task (lubrication interval, overhaul schedule)
- material: material involved (CFRP, titanium alloy, Inconel, hardened steel)
- environment: environmental condition (marine atmosphere, high humidity, elevated temperature)

Rules:
- Extract only reliability/FMEA-relevant facts.
- Do not invent unsupported claims.
- Direct claims must use evidence_text copied exactly from the title or abstract.
- Inferred claims must still cite evidence_text and include inference_rationale.
- Direct relationships must use relationship_evidence_text copied exactly from the title or abstract.
- Inferred relationships must still cite relationship_evidence_text and include inference_rationale.
- Prefer atomic claims: one fact per claim row.
- For failure_mode normalized_value, use a canonical mechanism label when supported by the evidence:
  Crack / fracture, Fatigue, Foreign object damage (FOD), Stall / surge,
  Flow disturbance / distortion, Blade vibration / flutter, Deformation / buckling,
  Wear / rubbing, Corrosion / pitting, Deposits / blockage, Leakage,
  Overheating / overtemperature, Bearing fault, Spallation, Seizure, Creep,
  Erosion, Oxidation, Delamination, Debonding, Coating failure, Thermal shock,
  Combustion instability, Rotor imbalance, Misalignment, Overspeed.
- Do not store symptoms or effects such as noise/acoustic issue, generic high vibration,
  engine shutdown, or operational loss as failure_mode claims. Store them as effect or detection_method when supported.
- If the paper has no failure analysis content, return not_relevant with no claims.
- Return possibly_relevant, not relevant, for RUL/prognostics/model-only papers unless they name a concrete component failure mode, cause, effect, control, detection method, or maintenance action.

Relationship direction rules:
- component -> has_failure_mode -> failure_mode
- failure_mode -> caused_by -> cause
- failure_mode -> has_effect -> effect
- failure_mode -> mitigated_by -> control
- failure_mode -> detected_by -> detection_method
- failure_mode -> corrected_by -> corrective_action
- failure_mode -> analysed_by -> analysis_method
- component or failure_mode -> has_context -> application, operating_context, material, or environment
- Never reverse analysed_by: analysis_method is the object, not the subject.
- Never use mitigation/control as the subject of mitigated_by; failure_mode is the subject.

Paper:
DOI: {paper.doi or ""}
Title: {paper.title}
Abstract: {paper.abstract or ""}
Journal: {paper.journal or ""}
Year: {paper.year or ""}
""".strip()


_GROQ_REQUEST_DELAY = 3.5  # ~17 papers/min stays under 12k TPM free tier


def _call_groq(prompt: str, config: LlmConfig) -> str:
    import time
    payload = {
        "model": config.model,
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0,
        "response_format": {"type": "json_object"},
    }
    data = _post_json(
        "https://api.groq.com/openai/v1/chat/completions",
        payload,
        headers={
            "Authorization": f"Bearer {config.api_key}",
            "Content-Type": "application/json",
            "User-Agent": "riskonradar-classifier/1.0",
        },
    )
    time.sleep(_GROQ_REQUEST_DELAY)
    try:
        return data["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError) as exc:
        raise LlmExtractorError(f"Unexpected Groq response: {data}") from exc


def _call_ollama(prompt: str, config: LlmConfig) -> str:
    base_url = os.environ.get("OLLAMA_BASE_URL", "http://localhost:11434")
    payload = {
        "model": config.model,
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0,
        "format": "json",  # Ollama native JSON mode — works across all models
        "stream": False,
    }
    data = _post_json(
        f"{base_url}/api/chat",
        payload,
        headers={"Content-Type": "application/json"},
    )
    try:
        return data["message"]["content"]
    except (KeyError, TypeError) as exc:
        raise LlmExtractorError(f"Unexpected Ollama response: {data}") from exc


def _call_gemini(prompt: str, config: LlmConfig) -> str:
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{config.model}:generateContent?key={config.api_key}"
    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {
            "temperature": 0,
            "responseMimeType": "application/json",
            "thinkingConfig": {"thinkingBudget": 0},
        },
    }
    data = _post_json(url, payload, headers={"Content-Type": "application/json"})
    try:
        return data["candidates"][0]["content"]["parts"][0]["text"]
    except (KeyError, IndexError, TypeError) as exc:
        raise LlmExtractorError(f"Unexpected Gemini response: {data}") from exc


def _call_openai(prompt: str, config: LlmConfig) -> str:
    payload = {
        "model": config.model,
        "input": [
            {
                "role": "user",
                "content": [{"type": "input_text", "text": prompt}],
            }
        ],
        "text": {"format": {"type": "json_object"}},
    }
    data = _post_json(
        "https://api.openai.com/v1/responses",
        payload,
        headers={"Authorization": f"Bearer {config.api_key}", "Content-Type": "application/json"},
    )
    try:
        for item in data["output"]:
            for content in item.get("content", []):
                if content.get("type") in {"output_text", "text"}:
                    return content["text"]
    except (KeyError, TypeError) as exc:
        raise LlmExtractorError(f"Unexpected OpenAI response: {data}") from exc
    raise LlmExtractorError(f"OpenAI response did not include text output: {data}")


def _call_anthropic(prompt: str, config: LlmConfig) -> str:
    payload = {
        "model": config.model,
        "max_tokens": 4096,
        "temperature": 0,
        "messages": [{"role": "user", "content": prompt}],
    }
    data = _post_json(
        "https://api.anthropic.com/v1/messages",
        payload,
        headers={
            "x-api-key": config.api_key,
            "anthropic-version": "2023-06-01",
            "Content-Type": "application/json",
        },
    )
    try:
        return "".join(part["text"] for part in data["content"] if part.get("type") == "text")
    except (KeyError, TypeError) as exc:
        raise LlmExtractorError(f"Unexpected Anthropic response: {data}") from exc


def _post_json(url: str, payload: dict[str, Any], headers: dict[str, str]) -> dict[str, Any]:
    request = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers=headers,
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise LlmExtractorError(f"LLM provider request failed: {exc.code} {detail}") from exc
    except urllib.error.URLError as exc:
        raise LlmExtractorError(f"LLM provider request failed: {exc}") from exc


def _parse_json_object(raw_text: str) -> dict[str, Any]:
    text = raw_text.strip()
    if text.startswith("```"):
        text = text.strip("`")
        if text.startswith("json"):
            text = text[4:].strip()
    try:
        value = json.loads(text)
    except json.JSONDecodeError as exc:
        raise LlmExtractorError(f"LLM returned invalid JSON: {raw_text[:500]}") from exc
    if not isinstance(value, dict):
        raise LlmExtractorError("LLM returned JSON that is not an object.")
    return value


def _result_from_payload(paper: Paper, payload: dict[str, Any], config: LlmConfig) -> ClassificationResult:
    claims: list[EvidenceClaim] = []
    # LLM relationship indices refer to positions in ITS claims array; gates drop
    # claims, so remap original positions -> surviving positions or edges would
    # silently attach to the wrong claim after any drop.
    index_map: dict[int, int] = {}
    for original_index, raw_claim in enumerate(payload.get("claims", [])):
        claim = _claim_from_payload(paper, raw_claim)
        if claim is not None:
            index_map[original_index] = len(claims)
            claims.append(claim)

    relationships: list[ClaimRelationship] = []
    for raw_relationship in payload.get("relationships", []):
        relationship = _relationship_from_payload(paper, raw_relationship, claims, index_map)
        if relationship is not None:
            relationships.append(relationship)

    relevance = payload.get("relevance") if payload.get("relevance") in {"relevant", "possibly_relevant", "not_relevant"} else "possibly_relevant"
    confidence = _bounded_float(payload.get("confidence"), default=0.5)
    raw_claims = payload.get("claims", [])
    raw_relationships = payload.get("relationships", [])
    direct_kept = sum(1 for c in claims if c.support_type == SupportType.DIRECT_SPAN)
    return ClassificationResult(
        relevance=relevance,
        confidence=confidence,
        claims=tuple(claims),
        relationships=tuple(relationships),
        metadata={
            "classifier_version": LLM_CLASSIFIER_VERSION,
            "extractor": "llm",
            "llm_provider": config.provider,
            "llm_model": config.model,
            "claim_count": len(claims),
            "relationship_count": len(relationships),
            # label-free eval counters: returned = what the LLM emitted,
            # kept = what survived the gates (survival rate = quote fidelity)
            "claims_returned": len(raw_claims) if isinstance(raw_claims, list) else 0,
            "relationships_returned": len(raw_relationships) if isinstance(raw_relationships, list) else 0,
            "direct_claims_kept": direct_kept,
        },
    )


def _claim_from_payload(paper: Paper, raw_claim: Any) -> EvidenceClaim | None:
    if not isinstance(raw_claim, dict):
        return None
    try:
        claim_type = ClaimType(raw_claim.get("claim_type"))
        support_type = SupportType(raw_claim.get("support_type"))
    except ValueError:
        return None

    raw_value = _clean_text(raw_claim.get("raw_value"))
    evidence_text = _clean_text(raw_claim.get("evidence_text"))
    source_field = raw_claim.get("source_field")
    if source_field not in {"title", "abstract"} or not raw_value or not evidence_text:
        return None

    source_text = paper.title if source_field == "title" else paper.abstract or ""
    span = _find_span(source_text, evidence_text)
    if span is None:
        return None
    char_start, char_end = span

    rationale = _clean_text(raw_claim.get("inference_rationale"))
    if support_type == SupportType.INFERRED_FROM_SPAN and not rationale:
        return None

    normalized_value = _clean_text(raw_claim.get("normalized_value"))
    if claim_type == ClaimType.FAILURE_MODE:
        normalized_value = canonical_failure_mode_label(" ".join(part for part in (normalized_value, raw_value) if part))
        if not normalized_value:
            return None

    return EvidenceClaim(
        claim_type=claim_type,
        raw_value=raw_value,
        normalized_value=normalized_value,
        support_type=support_type,
        confidence=_bounded_float(raw_claim.get("confidence"), default=0.5),
        spans=(EvidenceSpan(source_field, source_text[char_start:char_end], char_start, char_end),),
        inference_rationale=rationale,
        metadata={"extractor": "llm"},
    )


def _relationship_from_payload(
    paper: Paper,
    raw_relationship: Any,
    claims: list[EvidenceClaim],
    index_map: dict[int, int],
) -> ClaimRelationship | None:
    if not isinstance(raw_relationship, dict):
        return None
    try:
        original_subject_index = int(raw_relationship.get("subject_claim_index"))
        original_object_index = int(raw_relationship.get("object_claim_index"))
        relationship_type = RelationshipType(raw_relationship.get("relationship_type"))
        support_type = SupportType(raw_relationship.get("support_type"))
    except (TypeError, ValueError):
        return None
    subject_index = index_map.get(original_subject_index)
    object_index = index_map.get(original_object_index)
    if subject_index is None or object_index is None:
        # references a claim that was dropped by a gate
        return None
    if not _relationship_direction_is_valid(
        claims[subject_index].claim_type,
        relationship_type,
        claims[object_index].claim_type,
    ):
        return None
    metadata = {"extractor": "llm"}
    relationship_evidence_text = _clean_text(raw_relationship.get("relationship_evidence_text"))
    inference_rationale = _clean_text(raw_relationship.get("inference_rationale"))
    if support_type == SupportType.DIRECT_SPAN:
        # Same hallucination guard as claims: a direct relationship's quote must
        # exist in the source text, and we store the source's own slice.
        if not relationship_evidence_text:
            return None
        verified = None
        for source_text in (paper.title, paper.abstract or ""):
            span = _find_span(source_text, relationship_evidence_text)
            if span is not None:
                verified = source_text[span[0]:span[1]]
                break
        if verified is None:
            return None
        relationship_evidence_text = verified
    elif not inference_rationale:
        return None
    if relationship_evidence_text:
        metadata["relationship_evidence_text"] = relationship_evidence_text
    if inference_rationale:
        metadata["inference_rationale"] = inference_rationale
    return ClaimRelationship(
        subject_index=subject_index,
        relationship_type=relationship_type,
        object_index=object_index,
        support_type=support_type,
        confidence=_bounded_float(raw_relationship.get("confidence"), default=0.4),
        metadata=metadata,
    )


def _relationship_direction_is_valid(
    subject_type: ClaimType,
    relationship_type: RelationshipType,
    object_type: ClaimType,
) -> bool:
    if relationship_type == RelationshipType.HAS_FAILURE_MODE:
        return subject_type == ClaimType.COMPONENT and object_type == ClaimType.FAILURE_MODE
    if relationship_type == RelationshipType.CAUSED_BY:
        return subject_type == ClaimType.FAILURE_MODE and object_type == ClaimType.CAUSE
    if relationship_type == RelationshipType.HAS_EFFECT:
        return subject_type == ClaimType.FAILURE_MODE and object_type == ClaimType.EFFECT
    if relationship_type == RelationshipType.MITIGATED_BY:
        return subject_type == ClaimType.FAILURE_MODE and object_type == ClaimType.CONTROL
    if relationship_type == RelationshipType.DETECTED_BY:
        return subject_type == ClaimType.FAILURE_MODE and object_type == ClaimType.DETECTION_METHOD
    if relationship_type == RelationshipType.CORRECTED_BY:
        return subject_type == ClaimType.FAILURE_MODE and object_type == ClaimType.CORRECTIVE_ACTION
    if relationship_type == RelationshipType.ANALYSED_BY:
        return subject_type == ClaimType.FAILURE_MODE and object_type == ClaimType.ANALYSIS_METHOD
    if relationship_type == RelationshipType.HAS_CONTEXT:
        return subject_type in {ClaimType.COMPONENT, ClaimType.FAILURE_MODE} and object_type in {
            ClaimType.APPLICATION,
            ClaimType.OPERATING_CONTEXT,
            ClaimType.MATERIAL,
            ClaimType.ENVIRONMENT,
        }
    return False


def _find_span(source_text: str, evidence_text: str) -> tuple[int, int] | None:
    """Locate evidence_text in source_text, tolerant only of whitespace differences.

    Tokens must match verbatim (case-insensitive); runs of whitespace/newlines may
    differ between the LLM quote and the source. Returns source-text offsets.
    """
    tokens = evidence_text.split()
    if not tokens:
        return None
    pattern = r"\s+".join(re.escape(token) for token in tokens)
    match = re.search(pattern, source_text, flags=re.IGNORECASE)
    if match is None:
        return None
    return match.start(), match.end()


def _bounded_float(value: Any, default: float) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return default
    return max(0.0, min(number, 1.0))


def _clean_text(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).replace("\x00", "")
    text = "".join(
        character
        for character in text
        if character in {"\n", "\r", "\t"} or ord(character) >= 32
    ).strip()
    if text.lower() == "null":
        return None
    return text or None
