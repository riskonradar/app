from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from paper_classifier.evaluation import (
    EvaluationFormatError,
    score_predictions,
    validate_annotations,
    write_annotation_template,
    write_sample,
)
from paper_classifier.models import Paper


def _paper() -> Paper:
    return Paper(
        id="sample-1",
        doi="10.1000/eval",
        title="Bearing fatigue caused by poor lubrication",
        abstract="The bearing developed fatigue cracking because lubrication was inadequate.",
        journal="Engineering Failure Analysis",
        year=2026,
        authors=None,
        url="https://doi.org/10.1000/eval",
        source="test",
    )


class EvaluationTests(unittest.TestCase):
    def test_annotation_template_is_incomplete_until_human_labels_it(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            sample = Path(directory) / "sample.jsonl"
            annotations = Path(directory) / "annotations.jsonl"
            write_sample(sample, [_paper()])
            write_annotation_template(sample, annotations)

            with self.assertRaises(EvaluationFormatError):
                validate_annotations(sample, annotations)

    def test_annotations_require_evidence_verbatim_in_the_named_source(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            sample = Path(directory) / "sample.jsonl"
            annotations = Path(directory) / "annotations.jsonl"
            write_sample(sample, [_paper()])
            record = {
                "format_version": 1,
                "sample_id": "sample-1",
                "relevance": "relevant",
                "claims": [
                    {
                        "annotation_id": "c1",
                        "claim_type": "component",
                        "value": "bearing",
                        "source_field": "title",
                        "evidence_text": "not in the title",
                    }
                ],
                "relationships": [],
            }
            annotations.write_text(json.dumps(record) + "\n", encoding="utf-8")

            with self.assertRaises(EvaluationFormatError):
                validate_annotations(sample, annotations)

    def test_offline_scorer_compares_saved_predictions_without_model_calls(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            sample = root / "sample.jsonl"
            annotations = root / "annotations.jsonl"
            write_sample(sample, [_paper()])
            annotations.write_text(
                json.dumps(
                    {
                        "format_version": 1,
                        "sample_id": "sample-1",
                        "relevance": "relevant",
                        "claims": [
                            {
                                "annotation_id": "c1",
                                "claim_type": "component",
                                "value": "bearing",
                                "source_field": "title",
                                "evidence_text": "Bearing",
                            },
                            {
                                "annotation_id": "c2",
                                "claim_type": "failure_mode",
                                "value": "fatigue",
                                "source_field": "title",
                                "evidence_text": "fatigue",
                            },
                        ],
                        "relationships": [
                            {
                                "subject_annotation_id": "c1",
                                "relationship_type": "has_failure_mode",
                                "object_annotation_id": "c2",
                            }
                        ],
                    }
                )
                + "\n",
                encoding="utf-8",
            )
            prediction_paths = []
            for candidate, provider, model in (
                ("flash-lite", "gemini", "gemini-2.5-flash-lite"),
                ("gpt-5.4-nano", "openai", "gpt-5.4-nano"),
            ):
                path = root / f"{candidate}.jsonl"
                path.write_text(
                    json.dumps(
                        {
                            "format_version": 1,
                            "sample_id": "sample-1",
                            "model_candidate": candidate,
                            "provider": provider,
                            "model": model,
                            "prompt_sha256": "a" * 64,
                            "error": None,
                            "result": {
                                "relevance": "relevant",
                                "claims": [
                                    {"claim_type": "component", "raw_value": "bearing", "normalized_value": "bearing"},
                                    {"claim_type": "failure_mode", "raw_value": "fatigue", "normalized_value": "fatigue"},
                                ],
                                "relationships": [
                                    {"subject_index": 0, "relationship_type": "has_failure_mode", "object_index": 1}
                                ],
                                "metadata": {"claims_returned": 2},
                            },
                        }
                    )
                    + "\n",
                    encoding="utf-8",
                )
                prediction_paths.append(path)

            scores = score_predictions(sample, annotations, prediction_paths)

            self.assertEqual(scores["sample_count"], 1)
            self.assertEqual(scores["comparison"][0]["claim_f1"], 1.0)
            self.assertEqual(scores["comparison"][0]["relationship_f1"], 1.0)


if __name__ == "__main__":
    unittest.main()
