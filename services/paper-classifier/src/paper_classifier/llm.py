from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any

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

LLM_CLASSIFIER_VERSION = "llm-extractor-v2"


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


def extract_with_llm(paper: Paper, config: LlmConfig) -> ClassificationResult:
    prompt = _prompt_for(paper)
    if config.provider == "gemini":
        raw_text = _call_gemini(prompt, config)
    elif config.provider == "groq":
        raw_text = _call_groq(prompt, config)
    elif config.provider == "openai":
        raw_text = _call_openai(prompt, config)
    elif config.provider == "anthropic":
        raw_text = _call_anthropic(prompt, config)
    else:
        raise LlmExtractorError(f"Unsupported LLM_PROVIDER: {config.provider}")

    payload = _parse_json_object(raw_text)
    return _result_from_payload(paper, payload, config)


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
      "confidence": 0.0
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
- Prefer atomic claims: one fact per claim row.
- If the paper has no failure analysis content, return not_relevant with no claims.

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
        "max_tokens": 1800,
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
    for raw_claim in payload.get("claims", []):
        claim = _claim_from_payload(paper, raw_claim)
        if claim is not None:
            claims.append(claim)

    relationships: list[ClaimRelationship] = []
    for raw_relationship in payload.get("relationships", []):
        relationship = _relationship_from_payload(raw_relationship, len(claims))
        if relationship is not None:
            relationships.append(relationship)

    relevance = payload.get("relevance") if payload.get("relevance") in {"relevant", "possibly_relevant", "not_relevant"} else "possibly_relevant"
    confidence = _bounded_float(payload.get("confidence"), default=0.5)
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
    char_start = source_text.lower().find(evidence_text.lower())
    if char_start < 0:
        return None
    char_end = char_start + len(evidence_text)

    rationale = _clean_text(raw_claim.get("inference_rationale"))
    if support_type == SupportType.INFERRED_FROM_SPAN and not rationale:
        return None

    return EvidenceClaim(
        claim_type=claim_type,
        raw_value=raw_value,
        normalized_value=_clean_text(raw_claim.get("normalized_value")),
        support_type=support_type,
        confidence=_bounded_float(raw_claim.get("confidence"), default=0.5),
        spans=(EvidenceSpan(source_field, source_text[char_start:char_end], char_start, char_end),),
        inference_rationale=rationale,
        metadata={"extractor": "llm"},
    )


def _relationship_from_payload(raw_relationship: Any, claim_count: int) -> ClaimRelationship | None:
    if not isinstance(raw_relationship, dict):
        return None
    try:
        subject_index = int(raw_relationship.get("subject_claim_index"))
        object_index = int(raw_relationship.get("object_claim_index"))
        relationship_type = RelationshipType(raw_relationship.get("relationship_type"))
        support_type = SupportType(raw_relationship.get("support_type"))
    except (TypeError, ValueError):
        return None
    if not (0 <= subject_index < claim_count and 0 <= object_index < claim_count):
        return None
    return ClaimRelationship(
        subject_index=subject_index,
        relationship_type=relationship_type,
        object_index=object_index,
        support_type=support_type,
        confidence=_bounded_float(raw_relationship.get("confidence"), default=0.4),
        metadata={"extractor": "llm"},
    )


def _bounded_float(value: Any, default: float) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return default
    return max(0.0, min(number, 1.0))


def _clean_text(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    if text.lower() == "null":
        return None
    return text or None
