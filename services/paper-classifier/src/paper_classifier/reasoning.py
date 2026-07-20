from __future__ import annotations

import hashlib
import json
import os
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal
from typing import Any, Callable, Protocol
from uuid import UUID

from paper_classifier.llm import (
    LlmConfig,
    LlmExtractorError,
    _call_anthropic,
    _call_groq,
    _call_ollama,
    _call_openai,
    _parse_json_object,
    _post_json,
)


MANIFEST_VERSION = "accepted-system-evidence-v1"
REASONING_PROMPT_VERSION = "aggregate-system-reasoner-v1"
MAX_SYSTEM_INSTANCES = 250
MAX_DEPENDENCIES = 500
MAX_PROPAGATIONS = 250
MAX_EVIDENCE_CLAIMS = 500
MAX_RELATIONSHIPS = 1_000
MAX_SUGGESTIONS = 25
MAX_SPAN_TEXT = 800
MAX_MANIFEST_BYTES = 500_000

SUGGESTION_TYPES = {
    "failure_propagation",
    "fmea_gap",
    "review_priority",
    "control_gap",
}


class ReasoningError(RuntimeError):
    pass


@dataclass(frozen=True)
class ReasoningConfig:
    provider: str
    model: str
    api_key: str


@dataclass(frozen=True)
class ReasoningManifest:
    payload: dict[str, Any]
    canonical_json: str
    input_hash: str
    prompt_version: str = REASONING_PROMPT_VERSION


@dataclass(frozen=True)
class ReasoningOutcome:
    job_id: str
    status: str
    suggestion_count: int = 0
    reused: bool = False


class ReasoningRepository(Protocol):
    def claim_reasoning_job(
        self,
        manifest: ReasoningManifest,
        config: ReasoningConfig,
        retry_failed: bool,
    ) -> dict[str, Any]: ...

    def complete_reasoning_job(
        self,
        job_id: str,
        attempt: int,
        suggestions: list[dict[str, Any]],
    ) -> None: ...

    def fail_reasoning_job(self, job_id: str, attempt: int, error: str) -> None: ...


def load_reasoning_config() -> ReasoningConfig:
    provider = os.environ.get("REASONING_LLM_PROVIDER", "").strip().lower()
    model = os.environ.get("REASONING_LLM_MODEL", "").strip()
    api_key = os.environ.get("REASONING_LLM_API_KEY", "").strip()
    if provider not in {"gemini", "groq", "ollama", "openai", "anthropic"}:
        raise ReasoningError(
            "Set REASONING_LLM_PROVIDER to gemini, groq, ollama, openai, or anthropic."
        )
    if not model:
        raise ReasoningError("Set REASONING_LLM_MODEL explicitly.")
    if provider == "ollama":
        api_key = api_key or "ollama"
    elif not api_key:
        raise ReasoningError("Set REASONING_LLM_API_KEY explicitly.")
    return ReasoningConfig(provider=provider, model=model, api_key=api_key)


def build_reasoning_manifest(raw: dict[str, Any], max_claims: int) -> ReasoningManifest:
    if max_claims < 1 or max_claims > MAX_EVIDENCE_CLAIMS:
        raise ReasoningError(f"max_claims must be between 1 and {MAX_EVIDENCE_CLAIMS}.")
    asset = raw.get("asset")
    if not isinstance(asset, dict) or not asset.get("id") or not asset.get("organization_id"):
        raise ReasoningError("System asset was not found in the requested organization.")

    instances = _bounded_rows(raw.get("system_instances"), MAX_SYSTEM_INSTANCES, "system instances")
    dependencies = _bounded_rows(raw.get("dependencies"), MAX_DEPENDENCIES, "dependencies")
    propagations = _bounded_rows(raw.get("accepted_propagations"), MAX_PROPAGATIONS, "accepted propagations")
    all_claims = sorted(_rows(raw.get("accepted_evidence_claims")), key=_row_id)
    claims = all_claims[:max_claims]
    claim_ids = {str(row["id"]) for row in claims}
    relationships = [
        row
        for row in _rows(raw.get("accepted_evidence_relationships"))
        if str(row.get("subject_claim_id")) in claim_ids
        and str(row.get("object_claim_id")) in claim_ids
    ]
    relationships = _bounded_rows(relationships, MAX_RELATIONSHIPS, "evidence relationships")

    if not instances:
        raise ReasoningError("The system asset has no component instances.")
    if not claims and not propagations:
        raise ReasoningError("No tenant-accepted evidence or propagation is available for reasoning.")

    normalized_claims = []
    for claim in claims:
        item = dict(claim)
        item["spans"] = [
            {**dict(span), "text": str(span.get("text", ""))[:MAX_SPAN_TEXT]}
            for span in sorted(_rows(item.get("spans")), key=_row_id)[:3]
        ]
        normalized_claims.append(item)

    payload = {
        "manifest_version": MANIFEST_VERSION,
        "organization_id": str(asset["organization_id"]),
        "asset": _normalized(asset),
        "system_instances": sorted((_normalized(row) for row in instances), key=_row_id),
        "dependencies": sorted((_normalized(row) for row in dependencies), key=_row_id),
        "accepted_propagations": sorted(
            (_normalized(row) for row in propagations), key=_row_id
        ),
        "accepted_evidence_claims": [_normalized(row) for row in normalized_claims],
        "accepted_evidence_relationships": sorted(
            (_normalized(row) for row in relationships), key=_row_id
        ),
        "bounds": {
            "max_claims": max_claims,
            "claims_available": len(all_claims),
            "claims_included": len(claims),
            "claims_truncated": len(all_claims) > max_claims,
        },
    }
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=True)
    if len(canonical.encode("utf-8")) > MAX_MANIFEST_BYTES:
        raise ReasoningError("Reasoning manifest exceeds the 500 KB safety bound.")
    return ReasoningManifest(
        payload=payload,
        canonical_json=canonical,
        input_hash=hashlib.sha256(canonical.encode("utf-8")).hexdigest(),
    )


def execute_reasoning(
    repository: ReasoningRepository,
    manifest: ReasoningManifest,
    config: ReasoningConfig,
    retry_failed: bool = False,
    call_model: Callable[[str, ReasoningConfig], dict[str, Any]] | None = None,
) -> ReasoningOutcome:
    claimed = repository.claim_reasoning_job(manifest, config, retry_failed)
    job_id = str(claimed["id"])
    if not claimed.get("should_run"):
        return ReasoningOutcome(job_id=job_id, status=str(claimed["status"]), reused=True)
    attempt = int(claimed["attempts"])

    try:
        payload = (call_model or call_reasoning_model)(_reasoning_prompt(manifest), config)
        suggestions = validate_suggestions(payload, manifest)
        repository.complete_reasoning_job(job_id, attempt, suggestions)
        return ReasoningOutcome(
            job_id=job_id,
            status="completed",
            suggestion_count=len(suggestions),
        )
    except Exception as exc:
        repository.fail_reasoning_job(job_id, attempt, str(exc)[:2000])
        if isinstance(exc, ReasoningError):
            raise
        raise ReasoningError(f"Aggregate reasoning failed: {exc}") from exc


def call_reasoning_model(prompt: str, config: ReasoningConfig) -> dict[str, Any]:
    llm_config = LlmConfig(config.provider, config.model, config.api_key)
    try:
        if config.provider == "gemini":
            raw = _call_reasoning_gemini(prompt, llm_config)
        elif config.provider == "groq":
            raw = _call_groq(prompt, llm_config)
        elif config.provider == "ollama":
            raw = _call_ollama(prompt, llm_config)
        elif config.provider == "openai":
            raw = _call_openai(prompt, llm_config)
        elif config.provider == "anthropic":
            raw = _call_anthropic(prompt, llm_config)
        else:
            raise ReasoningError(f"Unsupported reasoning provider: {config.provider}")
        return _parse_json_object(raw)
    except LlmExtractorError as exc:
        raise ReasoningError(str(exc)) from exc


def _call_reasoning_gemini(prompt: str, config: LlmConfig) -> str:
    """Gemini JSON call without the extractor's intentionally disabled reasoning budget."""
    url = (
        "https://generativelanguage.googleapis.com/v1beta/models/"
        f"{config.model}:generateContent?key={config.api_key}"
    )
    data = _post_json(
        url,
        {
            "contents": [{"parts": [{"text": prompt}]}],
            "generationConfig": {
                "temperature": 0,
                "responseMimeType": "application/json",
            },
        },
        headers={"Content-Type": "application/json"},
    )
    try:
        return data["candidates"][0]["content"]["parts"][0]["text"]
    except (KeyError, IndexError, TypeError) as exc:
        raise LlmExtractorError(f"Unexpected Gemini response: {data}") from exc


def validate_suggestions(
    payload: dict[str, Any], manifest: ReasoningManifest
) -> list[dict[str, Any]]:
    raw_suggestions = payload.get("suggestions")
    if not isinstance(raw_suggestions, list):
        raise ReasoningError("Reasoning output must contain a suggestions array.")
    if len(raw_suggestions) > MAX_SUGGESTIONS:
        raise ReasoningError(f"Reasoning output exceeds {MAX_SUGGESTIONS} suggestions.")

    allowed = {
        "system_instance_ids": _ids(manifest.payload["system_instances"]),
        "evidence_claim_ids": _ids(manifest.payload["accepted_evidence_claims"]),
        "evidence_relationship_ids": _ids(
            manifest.payload["accepted_evidence_relationships"]
        ),
        "failure_propagation_ids": _ids(manifest.payload["accepted_propagations"]),
    }
    validated: list[dict[str, Any]] = []
    seen: set[str] = set()
    for raw in raw_suggestions:
        if not isinstance(raw, dict) or raw.get("suggestion_type") not in SUGGESTION_TYPES:
            raise ReasoningError("Reasoning output contains an invalid suggestion type.")
        item = {
            "suggestion_type": raw["suggestion_type"],
            "title": _required_text(raw.get("title"), 160, "title"),
            "summary": _required_text(raw.get("summary"), 1200, "summary"),
            "rationale": _required_text(raw.get("rationale"), 3000, "rationale"),
            "confidence": _confidence(raw.get("confidence")),
        }
        for field, allowed_ids in allowed.items():
            values = raw.get(field, [])
            if not isinstance(values, list) or any(not isinstance(value, str) for value in values):
                raise ReasoningError(f"{field} must be an array of input IDs.")
            normalized_ids = sorted(set(values))
            if not set(normalized_ids).issubset(allowed_ids):
                raise ReasoningError(f"{field} contains an ID outside the input manifest.")
            item[field] = normalized_ids
        if not item["system_instance_ids"]:
            raise ReasoningError("Every suggestion must cite at least one system instance.")
        if not (
            item["evidence_claim_ids"]
            or item["evidence_relationship_ids"]
            or item["failure_propagation_ids"]
        ):
            raise ReasoningError("Every suggestion must cite accepted evidence lineage.")
        canonical = json.dumps(item, sort_keys=True, separators=(",", ":"))
        key = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
        if key in seen:
            continue
        seen.add(key)
        validated.append({**item, "suggestion_key": key})
    return validated


def _reasoning_prompt(manifest: ReasoningManifest) -> str:
    return f"""You are a reliability-engineering review assistant working over an accepted aggregate graph.
Return only JSON: {{"suggestions":[{{"suggestion_type":"failure_propagation|fmea_gap|review_priority|control_gap","title":"...","summary":"...","rationale":"...","confidence":0.0,"system_instance_ids":["..."],"evidence_claim_ids":["..."],"evidence_relationship_ids":["..."],"failure_propagation_ids":["..."]}}]}}.
Every ID must appear in the matching input array. Do not invent facts, IDs, risk scores, occurrence rates, or compliance claims. Suggestions are hypotheses for human review, not changes to system or FMEA truth. Return at most {MAX_SUGGESTIONS} suggestions.
Prompt version: {manifest.prompt_version}
Input manifest: {manifest.canonical_json}
"""


def _rows(value: Any) -> list[dict[str, Any]]:
    return [dict(row) for row in value] if isinstance(value, list) else []


def _bounded_rows(value: Any, maximum: int, label: str) -> list[dict[str, Any]]:
    rows = _rows(value)
    if len(rows) > maximum:
        raise ReasoningError(f"Aggregate graph exceeds the {maximum} {label} safety bound.")
    return rows


def _normalized(value: Any) -> Any:
    if isinstance(value, dict):
        return {str(key): _normalized(item) for key, item in sorted(value.items())}
    if isinstance(value, list):
        return [_normalized(item) for item in value]
    if isinstance(value, UUID):
        return str(value)
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    return value


def _row_id(row: dict[str, Any]) -> str:
    return str(row.get("id", ""))


def _ids(rows: list[dict[str, Any]]) -> set[str]:
    return {str(row["id"]) for row in rows}


def _required_text(value: Any, maximum: int, label: str) -> str:
    text = str(value).strip() if value is not None else ""
    if not text or len(text) > maximum:
        raise ReasoningError(f"Suggestion {label} must contain 1-{maximum} characters.")
    return text


def _confidence(value: Any) -> float:
    try:
        confidence = float(value)
    except (TypeError, ValueError) as exc:
        raise ReasoningError("Suggestion confidence must be numeric.") from exc
    if not 0 <= confidence <= 1:
        raise ReasoningError("Suggestion confidence must be between 0 and 1.")
    return confidence
