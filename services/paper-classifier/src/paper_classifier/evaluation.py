from __future__ import annotations

import hashlib
import json
import os
import re
import unicodedata
from dataclasses import asdict
from pathlib import Path
from typing import Any, Iterable

from paper_classifier.llm import LlmConfig, _prompt_for, extract_with_llm
from paper_classifier.models import ClassificationResult, ClaimType, Paper, RelationshipType


EVAL_FORMAT_VERSION = 1
MODEL_CANDIDATES: dict[str, tuple[str, str, str]] = {
    "flash-lite": ("gemini", "gemini-2.5-flash-lite", "GEMINI_API_KEY"),
    "gpt-5.4-nano": ("openai", "gpt-5.4-nano", "OPENAI_API_KEY"),
    "haiku-4.5": ("anthropic", "claude-haiku-4-5", "ANTHROPIC_API_KEY"),
}


class EvaluationFormatError(ValueError):
    pass


def write_sample(path: Path, papers: Iterable[Paper]) -> int:
    records = [
        {
            "format_version": EVAL_FORMAT_VERSION,
            "sample_id": paper.id,
            "paper": asdict(paper),
        }
        for paper in papers
    ]
    _write_jsonl(path, records)
    return len(records)


def write_annotation_template(sample_path: Path, output_path: Path) -> int:
    samples = load_sample(sample_path)
    records = [
        {
            "format_version": EVAL_FORMAT_VERSION,
            "sample_id": sample_id,
            "relevance": None,
            "claims": [],
            "relationships": [],
            "notes": "",
        }
        for sample_id, _ in samples
    ]
    _write_jsonl(output_path, records)
    return len(records)


def load_sample(path: Path) -> list[tuple[str, Paper]]:
    records = _read_jsonl(path)
    samples: list[tuple[str, Paper]] = []
    seen: set[str] = set()
    for line_number, record in records:
        _require_version(record, path, line_number)
        sample_id = _required_text(record, "sample_id", path, line_number)
        if sample_id in seen:
            raise EvaluationFormatError(f"{path}:{line_number}: duplicate sample_id {sample_id!r}")
        paper_payload = record.get("paper")
        if not isinstance(paper_payload, dict):
            raise EvaluationFormatError(f"{path}:{line_number}: paper must be an object")
        try:
            paper = Paper(**paper_payload)
        except TypeError as exc:
            raise EvaluationFormatError(f"{path}:{line_number}: invalid paper: {exc}") from exc
        if paper.id != sample_id:
            raise EvaluationFormatError(f"{path}:{line_number}: paper.id must equal sample_id")
        seen.add(sample_id)
        samples.append((sample_id, paper))
    if not samples:
        raise EvaluationFormatError(f"{path}: sample is empty")
    return samples


def validate_annotations(sample_path: Path, annotation_path: Path) -> int:
    samples = dict(load_sample(sample_path))
    annotations = _load_annotations(annotation_path)
    if set(samples) != set(annotations):
        missing = sorted(set(samples) - set(annotations))
        extra = sorted(set(annotations) - set(samples))
        raise EvaluationFormatError(
            f"annotation/sample IDs differ; missing={missing[:5]}, extra={extra[:5]}"
        )

    for sample_id, annotation in annotations.items():
        paper = samples[sample_id]
        claim_ids: set[str] = set()
        for claim in annotation["claims"]:
            annotation_id = claim["annotation_id"]
            if annotation_id in claim_ids:
                raise EvaluationFormatError(f"{sample_id}: duplicate annotation_id {annotation_id!r}")
            claim_ids.add(annotation_id)
            source_text = _paper_source(paper, claim["source_field"])
            if not _contains_evidence(source_text, claim["evidence_text"]):
                raise EvaluationFormatError(
                    f"{sample_id}/{annotation_id}: evidence_text is not in {claim['source_field']}"
                )
        for relationship in annotation["relationships"]:
            if relationship["subject_annotation_id"] not in claim_ids:
                raise EvaluationFormatError(f"{sample_id}: relationship subject is unknown")
            if relationship["object_annotation_id"] not in claim_ids:
                raise EvaluationFormatError(f"{sample_id}: relationship object is unknown")
    return len(samples)


def evaluation_config(candidate_name: str) -> LlmConfig:
    try:
        provider, model, key_name = MODEL_CANDIDATES[candidate_name]
    except KeyError as exc:
        raise EvaluationFormatError(f"unknown model candidate: {candidate_name}") from exc
    api_key = os.environ.get(key_name)
    if not api_key:
        raise EvaluationFormatError(f"set {key_name} to evaluate {candidate_name}")
    return LlmConfig(provider=provider, model=model, api_key=api_key)


def run_model_evaluation(
    sample_path: Path,
    output_path: Path,
    candidate_name: str,
) -> int:
    if output_path.exists():
        raise EvaluationFormatError(f"refusing to overwrite existing predictions: {output_path}")
    config = evaluation_config(candidate_name)
    records: list[dict[str, Any]] = []
    for sample_id, paper in load_sample(sample_path):
        prompt_hash = hashlib.sha256(_prompt_for(paper).encode("utf-8")).hexdigest()
        try:
            result = extract_with_llm(paper, config)
            record = {
                "format_version": EVAL_FORMAT_VERSION,
                "sample_id": sample_id,
                "model_candidate": candidate_name,
                "provider": config.provider,
                "model": config.model,
                "prompt_sha256": prompt_hash,
                "result": _serialize_result(result),
                "error": None,
            }
        except Exception as exc:
            record = {
                "format_version": EVAL_FORMAT_VERSION,
                "sample_id": sample_id,
                "model_candidate": candidate_name,
                "provider": config.provider,
                "model": config.model,
                "prompt_sha256": prompt_hash,
                "result": None,
                "error": f"{type(exc).__name__}: {exc}",
            }
        records.append(record)
    _write_jsonl(output_path, records)
    return len(records)


def score_predictions(
    sample_path: Path,
    annotation_path: Path,
    prediction_paths: list[Path],
) -> dict[str, Any]:
    validate_annotations(sample_path, annotation_path)
    sample_ids = [sample_id for sample_id, _ in load_sample(sample_path)]
    annotations = _load_annotations(annotation_path)
    predictions = [_load_predictions(path) for path in prediction_paths]
    _validate_prediction_sets(sample_ids, predictions)

    prompt_hashes: dict[str, set[str]] = {sample_id: set() for sample_id in sample_ids}
    comparisons: list[dict[str, Any]] = []
    for prediction_set in predictions:
        model_name = prediction_set["model_candidate"]
        records = prediction_set["records"]
        counters = {
            "claim_tp": 0,
            "claim_fp": 0,
            "claim_fn": 0,
            "relationship_tp": 0,
            "relationship_fp": 0,
            "relationship_fn": 0,
            "relevance_correct": 0,
            "errors": 0,
            "claims_returned": 0,
            "claims_kept": 0,
        }
        for sample_id in sample_ids:
            annotation = annotations[sample_id]
            prediction = records[sample_id]
            prompt_hashes[sample_id].add(prediction["prompt_sha256"])
            result = prediction.get("result")
            if not isinstance(result, dict):
                counters["errors"] += 1
                predicted_claims: list[dict[str, Any]] = []
                predicted_relationships: list[dict[str, Any]] = []
                predicted_relevance = None
                metadata: dict[str, Any] = {}
            else:
                predicted_claims = result.get("claims", [])
                predicted_relationships = result.get("relationships", [])
                predicted_relevance = result.get("relevance")
                metadata = result.get("metadata", {})

            expected_claims = {
                _claim_key(claim["claim_type"], claim["value"])
                for claim in annotation["claims"]
            }
            actual_claims = {
                _claim_key(
                    claim["claim_type"],
                    claim.get("normalized_value") or claim["raw_value"],
                )
                for claim in predicted_claims
            }
            counters["claim_tp"] += len(expected_claims & actual_claims)
            counters["claim_fp"] += len(actual_claims - expected_claims)
            counters["claim_fn"] += len(expected_claims - actual_claims)

            expected_relationships = _annotation_relationship_keys(annotation)
            actual_relationships = _prediction_relationship_keys(
                predicted_claims, predicted_relationships
            )
            counters["relationship_tp"] += len(expected_relationships & actual_relationships)
            counters["relationship_fp"] += len(actual_relationships - expected_relationships)
            counters["relationship_fn"] += len(expected_relationships - actual_relationships)
            counters["relevance_correct"] += int(predicted_relevance == annotation["relevance"])
            counters["claims_returned"] += int(metadata.get("claims_returned") or 0)
            counters["claims_kept"] += len(predicted_claims)

        comparisons.append(
            {
                "model_candidate": model_name,
                "provider": prediction_set["provider"],
                "model": prediction_set["model"],
                "papers": len(sample_ids),
                "errors": counters["errors"],
                "relevance_accuracy": counters["relevance_correct"] / len(sample_ids),
                "claim_precision": _ratio(counters["claim_tp"], counters["claim_tp"] + counters["claim_fp"]),
                "claim_recall": _ratio(counters["claim_tp"], counters["claim_tp"] + counters["claim_fn"]),
                "claim_f1": _f1(counters["claim_tp"], counters["claim_fp"], counters["claim_fn"]),
                "relationship_precision": _ratio(counters["relationship_tp"], counters["relationship_tp"] + counters["relationship_fp"]),
                "relationship_recall": _ratio(counters["relationship_tp"], counters["relationship_tp"] + counters["relationship_fn"]),
                "relationship_f1": _f1(counters["relationship_tp"], counters["relationship_fp"], counters["relationship_fn"]),
                "quote_survival_rate": _ratio(counters["claims_kept"], counters["claims_returned"]),
            }
        )

    mismatched = [sample_id for sample_id, hashes in prompt_hashes.items() if len(hashes) != 1]
    if mismatched:
        raise EvaluationFormatError(
            f"models did not receive identical prompts for sample IDs: {mismatched[:5]}"
        )
    return {
        "format_version": EVAL_FORMAT_VERSION,
        "sample_count": len(sample_ids),
        "comparison": comparisons,
    }


def _serialize_result(result: ClassificationResult) -> dict[str, Any]:
    return {
        "relevance": result.relevance,
        "confidence": result.confidence,
        "claims": [
            {
                "claim_type": claim.claim_type.value,
                "raw_value": claim.raw_value,
                "normalized_value": claim.normalized_value,
                "support_type": claim.support_type.value,
                "confidence": claim.confidence,
                "spans": [asdict(span) for span in claim.spans],
                "inference_rationale": claim.inference_rationale,
                "metadata": claim.metadata,
            }
            for claim in result.claims
        ],
        "relationships": [
            {
                "subject_index": relationship.subject_index,
                "relationship_type": relationship.relationship_type.value,
                "object_index": relationship.object_index,
                "support_type": relationship.support_type.value,
                "confidence": relationship.confidence,
                "metadata": relationship.metadata,
            }
            for relationship in result.relationships
        ],
        "metadata": result.metadata,
    }


def _load_annotations(path: Path) -> dict[str, dict[str, Any]]:
    annotations: dict[str, dict[str, Any]] = {}
    for line_number, record in _read_jsonl(path):
        _require_version(record, path, line_number)
        sample_id = _required_text(record, "sample_id", path, line_number)
        relevance = record.get("relevance")
        if relevance not in {"relevant", "possibly_relevant", "not_relevant"}:
            raise EvaluationFormatError(f"{path}:{line_number}: relevance is not annotated")
        claims = record.get("claims")
        relationships = record.get("relationships")
        if not isinstance(claims, list) or not isinstance(relationships, list):
            raise EvaluationFormatError(f"{path}:{line_number}: claims/relationships must be arrays")
        normalized_claims = []
        for claim in claims:
            if not isinstance(claim, dict):
                raise EvaluationFormatError(f"{path}:{line_number}: claim must be an object")
            claim_type = _dict_text(claim, "claim_type", path, line_number)
            try:
                ClaimType(claim_type)
            except ValueError as exc:
                raise EvaluationFormatError(
                    f"{path}:{line_number}: unknown claim_type {claim_type!r}"
                ) from exc
            normalized_claims.append(
                {
                    "annotation_id": _dict_text(claim, "annotation_id", path, line_number),
                    "claim_type": claim_type,
                    "value": _dict_text(claim, "value", path, line_number),
                    "source_field": _source_field(claim.get("source_field"), path, line_number),
                    "evidence_text": _dict_text(claim, "evidence_text", path, line_number),
                }
            )
        normalized_relationships = []
        for relationship in relationships:
            if not isinstance(relationship, dict):
                raise EvaluationFormatError(f"{path}:{line_number}: relationship must be an object")
            relationship_type = _dict_text(
                relationship, "relationship_type", path, line_number
            )
            try:
                RelationshipType(relationship_type)
            except ValueError as exc:
                raise EvaluationFormatError(
                    f"{path}:{line_number}: unknown relationship_type {relationship_type!r}"
                ) from exc
            normalized_relationships.append(
                {
                    "subject_annotation_id": _dict_text(relationship, "subject_annotation_id", path, line_number),
                    "relationship_type": relationship_type,
                    "object_annotation_id": _dict_text(relationship, "object_annotation_id", path, line_number),
                }
            )
        if sample_id in annotations:
            raise EvaluationFormatError(f"{path}:{line_number}: duplicate sample_id {sample_id!r}")
        annotations[sample_id] = {
            "relevance": relevance,
            "claims": normalized_claims,
            "relationships": normalized_relationships,
        }
    return annotations


def _load_predictions(path: Path) -> dict[str, Any]:
    records: dict[str, dict[str, Any]] = {}
    model_candidate = provider = model = None
    for line_number, record in _read_jsonl(path):
        _require_version(record, path, line_number)
        sample_id = _required_text(record, "sample_id", path, line_number)
        current = (
            _required_text(record, "model_candidate", path, line_number),
            _required_text(record, "provider", path, line_number),
            _required_text(record, "model", path, line_number),
        )
        if model_candidate is None:
            model_candidate, provider, model = current
        elif current != (model_candidate, provider, model):
            raise EvaluationFormatError(f"{path}:{line_number}: mixed model predictions")
        prompt_hash = _required_text(record, "prompt_sha256", path, line_number)
        if not re.fullmatch(r"[0-9a-f]{64}", prompt_hash):
            raise EvaluationFormatError(f"{path}:{line_number}: invalid prompt_sha256")
        if sample_id in records:
            raise EvaluationFormatError(f"{path}:{line_number}: duplicate sample_id {sample_id!r}")
        records[sample_id] = record
    if model_candidate is None:
        raise EvaluationFormatError(f"{path}: predictions are empty")
    return {
        "model_candidate": model_candidate,
        "provider": provider,
        "model": model,
        "records": records,
    }


def _validate_prediction_sets(sample_ids: list[str], predictions: list[dict[str, Any]]) -> None:
    if not predictions:
        raise EvaluationFormatError("at least one predictions file is required")
    expected = set(sample_ids)
    model_names: set[str] = set()
    for prediction in predictions:
        if set(prediction["records"]) != expected:
            raise EvaluationFormatError(
                f"prediction IDs differ for {prediction['model_candidate']}"
            )
        if prediction["model_candidate"] in model_names:
            raise EvaluationFormatError(
                f"duplicate model candidate {prediction['model_candidate']}"
            )
        model_names.add(prediction["model_candidate"])


def _annotation_relationship_keys(annotation: dict[str, Any]) -> set[tuple[Any, ...]]:
    claim_keys = {
        claim["annotation_id"]: _claim_key(claim["claim_type"], claim["value"])
        for claim in annotation["claims"]
    }
    return {
        (
            claim_keys[relationship["subject_annotation_id"]],
            relationship["relationship_type"],
            claim_keys[relationship["object_annotation_id"]],
        )
        for relationship in annotation["relationships"]
    }


def _prediction_relationship_keys(
    claims: list[dict[str, Any]], relationships: list[dict[str, Any]]
) -> set[tuple[Any, ...]]:
    keys: set[tuple[Any, ...]] = set()
    for relationship in relationships:
        try:
            subject = claims[int(relationship["subject_index"])]
            object_claim = claims[int(relationship["object_index"])]
            keys.add(
                (
                    _claim_key(subject["claim_type"], subject.get("normalized_value") or subject["raw_value"]),
                    relationship["relationship_type"],
                    _claim_key(object_claim["claim_type"], object_claim.get("normalized_value") or object_claim["raw_value"]),
                )
            )
        except (IndexError, KeyError, TypeError, ValueError):
            continue
    return keys


def _claim_key(claim_type: str, value: str) -> tuple[str, str]:
    normalized = unicodedata.normalize("NFKC", value).casefold()
    normalized = re.sub(r"[^\w]+", " ", normalized)
    return claim_type, " ".join(normalized.split())


def _contains_evidence(source_text: str, evidence_text: str) -> bool:
    tokens = evidence_text.split()
    if not tokens:
        return False
    return re.search(r"\s+".join(re.escape(token) for token in tokens), source_text, re.I) is not None


def _paper_source(paper: Paper, source_field: str) -> str:
    if source_field == "title":
        return paper.title
    if source_field == "abstract":
        return paper.abstract or ""
    if source_field == "full_text":
        return paper.full_text or ""
    raise EvaluationFormatError(f"unknown source field: {source_field}")


def _read_jsonl(path: Path) -> list[tuple[int, dict[str, Any]]]:
    records: list[tuple[int, dict[str, Any]]] = []
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except OSError as exc:
        raise EvaluationFormatError(f"cannot read {path}: {exc}") from exc
    for line_number, line in enumerate(lines, 1):
        if not line.strip():
            continue
        try:
            value = json.loads(line)
        except json.JSONDecodeError as exc:
            raise EvaluationFormatError(f"{path}:{line_number}: invalid JSON") from exc
        if not isinstance(value, dict):
            raise EvaluationFormatError(f"{path}:{line_number}: record must be an object")
        records.append((line_number, value))
    return records


def _write_jsonl(path: Path, records: Iterable[dict[str, Any]]) -> None:
    if path.exists():
        raise EvaluationFormatError(f"refusing to overwrite existing evaluation artifact: {path}")
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = "".join(json.dumps(record, ensure_ascii=False) + "\n" for record in records)
    path.write_text(payload, encoding="utf-8")


def _require_version(record: dict[str, Any], path: Path, line_number: int) -> None:
    if record.get("format_version") != EVAL_FORMAT_VERSION:
        raise EvaluationFormatError(
            f"{path}:{line_number}: format_version must be {EVAL_FORMAT_VERSION}"
        )


def _required_text(record: dict[str, Any], key: str, path: Path, line_number: int) -> str:
    return _dict_text(record, key, path, line_number)


def _dict_text(record: dict[str, Any], key: str, path: Path, line_number: int) -> str:
    value = record.get(key)
    if not isinstance(value, str) or not value.strip():
        raise EvaluationFormatError(f"{path}:{line_number}: {key} must be non-empty text")
    return value.strip()


def _source_field(value: Any, path: Path, line_number: int) -> str:
    if value not in {"title", "abstract", "full_text"}:
        raise EvaluationFormatError(
            f"{path}:{line_number}: source_field must be title, abstract, or full_text"
        )
    return value


def _ratio(numerator: int, denominator: int) -> float:
    return numerator / denominator if denominator else 1.0


def _f1(true_positive: int, false_positive: int, false_negative: int) -> float:
    precision = _ratio(true_positive, true_positive + false_positive)
    recall = _ratio(true_positive, true_positive + false_negative)
    return 2 * precision * recall / (precision + recall) if precision + recall else 0.0
