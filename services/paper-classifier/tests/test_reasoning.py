from __future__ import annotations

import copy
import json
import os
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

from paper_classifier.reasoning import (
    REASONING_PROMPT_VERSION,
    ReasoningConfig,
    ReasoningError,
    build_reasoning_manifest,
    execute_reasoning,
    load_reasoning_config,
    validate_suggestions,
)
from paper_classifier.repository import PostgresRepository


FIXTURE = Path(__file__).parent / "fixtures" / "reasoning_input.json"


def fixture_input() -> dict:
    return json.loads(FIXTURE.read_text(encoding="utf-8"))


def valid_output() -> dict:
    return {
        "suggestions": [
            {
                "suggestion_type": "failure_propagation",
                "title": "Review bearing-to-shaft propagation",
                "summary": "Accepted fatigue evidence may affect the connected shaft.",
                "rationale": "The accepted system dependency and evidence relation share the bearing instance.",
                "confidence": 0.78,
                "system_instance_ids": [
                    "11111111-1111-4111-8111-111111111111",
                    "22222222-2222-4222-8222-222222222222",
                ],
                "evidence_claim_ids": ["55555555-5555-4555-8555-555555555555"],
                "evidence_relationship_ids": [
                    "77777777-7777-4777-8777-777777777777"
                ],
                "failure_propagation_ids": [
                    "44444444-4444-4444-8444-444444444444"
                ],
            }
        ]
    }


def query_result(row: dict | None) -> MagicMock:
    result = MagicMock()
    result.fetchone.return_value = row
    return result


class FakeRepository:
    def __init__(self, claimed: dict | None = None) -> None:
        self.claimed = claimed or {
            "id": "job-1",
            "status": "running",
            "attempts": 1,
            "should_run": True,
        }
        self.completed: tuple[str, int, list[dict]] | None = None
        self.failed: tuple[str, int, str] | None = None

    def claim_reasoning_job(self, manifest, config, retry_failed):
        self.claim_args = (manifest, config, retry_failed)
        return self.claimed

    def complete_reasoning_job(self, job_id, attempt, suggestions):
        self.completed = (job_id, attempt, suggestions)

    def fail_reasoning_job(self, job_id, attempt, error):
        self.failed = (job_id, attempt, error)


class ReasoningTests(unittest.TestCase):
    def test_manifest_is_bounded_canonical_and_order_independent(self) -> None:
        raw = fixture_input()
        first = build_reasoning_manifest(raw, 20)
        shuffled = copy.deepcopy(raw)
        shuffled["system_instances"].reverse()
        shuffled["accepted_evidence_claims"].reverse()
        second = build_reasoning_manifest(shuffled, 20)

        self.assertEqual(first.input_hash, second.input_hash)
        self.assertEqual(first.canonical_json, second.canonical_json)
        self.assertEqual(first.prompt_version, REASONING_PROMPT_VERSION)
        self.assertEqual(len(first.input_hash), 64)

    def test_reasoning_configuration_is_explicit_and_separate(self) -> None:
        with patch.dict(os.environ, {"LLM_PROVIDER": "gemini"}, clear=False):
            os.environ.pop("REASONING_LLM_PROVIDER", None)
            os.environ.pop("REASONING_LLM_MODEL", None)
            os.environ.pop("REASONING_LLM_API_KEY", None)
            with self.assertRaisesRegex(ReasoningError, "REASONING_LLM_PROVIDER"):
                load_reasoning_config()

        with patch.dict(
            os.environ,
            {
                "REASONING_LLM_PROVIDER": "anthropic",
                "REASONING_LLM_MODEL": "strong-review-model",
                "REASONING_LLM_API_KEY": "test-key",
            },
            clear=False,
        ):
            self.assertEqual(
                load_reasoning_config(),
                ReasoningConfig(
                    provider="anthropic",
                    model="strong-review-model",
                    api_key="test-key",
                ),
            )

    def test_output_rejects_any_id_outside_the_input_manifest(self) -> None:
        manifest = build_reasoning_manifest(fixture_input(), 20)
        output = valid_output()
        output["suggestions"][0]["evidence_claim_ids"] = [
            "00000000-0000-4000-8000-000000000000"
        ]
        with self.assertRaisesRegex(ReasoningError, "outside the input manifest"):
            validate_suggestions(output, manifest)

    def test_execute_stores_only_validated_review_suggestions(self) -> None:
        manifest = build_reasoning_manifest(fixture_input(), 20)
        repository = FakeRepository()
        calls = []

        def fake_model(prompt, config):
            calls.append((prompt, config))
            return valid_output()

        outcome = execute_reasoning(
            repository,
            manifest,
            ReasoningConfig("anthropic", "strong-review-model", "test-key"),
            call_model=fake_model,
        )

        self.assertEqual(outcome.status, "completed")
        self.assertEqual(outcome.suggestion_count, 1)
        self.assertEqual(len(calls), 1)
        self.assertIsNotNone(repository.completed)
        assert repository.completed is not None
        self.assertEqual(repository.completed[1], 1)
        suggestion = repository.completed[2][0]
        self.assertEqual(
            suggestion["system_instance_ids"],
            sorted(valid_output()["suggestions"][0]["system_instance_ids"]),
        )
        self.assertEqual(len(suggestion["suggestion_key"]), 64)
        self.assertIsNone(repository.failed)

    def test_completed_idempotent_job_never_calls_model(self) -> None:
        manifest = build_reasoning_manifest(fixture_input(), 20)
        repository = FakeRepository(
            {"id": "job-existing", "status": "completed", "should_run": False}
        )

        outcome = execute_reasoning(
            repository,
            manifest,
            ReasoningConfig("anthropic", "strong-review-model", "test-key"),
            call_model=lambda *_: self.fail("model must not be called"),
        )

        self.assertTrue(outcome.reused)
        self.assertEqual(outcome.status, "completed")
        self.assertIsNone(repository.completed)

    def test_invalid_model_output_marks_job_failed(self) -> None:
        manifest = build_reasoning_manifest(fixture_input(), 20)
        repository = FakeRepository()
        with self.assertRaisesRegex(ReasoningError, "suggestions array"):
            execute_reasoning(
                repository,
                manifest,
                ReasoningConfig("anthropic", "strong-review-model", "test-key"),
                call_model=lambda *_: {},
            )
        self.assertIsNotNone(repository.failed)
        assert repository.failed is not None
        self.assertEqual(repository.failed[1], 1)

    def test_reclaimed_attempt_is_used_as_completion_fence(self) -> None:
        manifest = build_reasoning_manifest(fixture_input(), 20)
        repository = FakeRepository(
            {"id": "job-reclaimed", "status": "running", "attempts": 2, "should_run": True}
        )

        execute_reasoning(
            repository,
            manifest,
            ReasoningConfig("anthropic", "strong-review-model", "test-key"),
            call_model=lambda *_: valid_output(),
        )

        self.assertIsNotNone(repository.completed)
        assert repository.completed is not None
        self.assertEqual(repository.completed[:2], ("job-reclaimed", 2))

    def test_stale_running_job_is_reclaimed_after_process_termination(self) -> None:
        connection = MagicMock()
        connection.execute.side_effect = [
            query_result(None),
            query_result(
                {"id": "job-reclaimed", "status": "running", "attempts": 2}
            ),
        ]
        repository = PostgresRepository("postgresql://unused")
        repository.connection = connection

        claimed = repository.claim_reasoning_job(
            build_reasoning_manifest(fixture_input(), 20),
            ReasoningConfig("anthropic", "strong-review-model", "test-key"),
            retry_failed=False,
        )

        self.assertEqual(
            claimed,
            {
                "id": "job-reclaimed",
                "status": "running",
                "attempts": 2,
                "should_run": True,
            },
        )
        reclaim_sql = connection.execute.call_args_list[1].args[0]
        self.assertIn("status = 'running' and lease_expires_at <= now()", reclaim_sql)
        self.assertIn("attempts < 3", reclaim_sql)

    def test_exhausted_stale_running_job_becomes_terminal_failure(self) -> None:
        connection = MagicMock()
        connection.execute.side_effect = [
            query_result(None),
            query_result(None),
            query_result({"id": "job-exhausted", "status": "failed", "attempts": 3}),
        ]
        repository = PostgresRepository("postgresql://unused")
        repository.connection = connection

        claimed = repository.claim_reasoning_job(
            build_reasoning_manifest(fixture_input(), 20),
            ReasoningConfig("anthropic", "strong-review-model", "test-key"),
            retry_failed=False,
        )

        self.assertEqual(claimed["status"], "failed")
        self.assertFalse(claimed["should_run"])
        exhaustion_sql = connection.execute.call_args_list[2].args[0]
        self.assertIn("lease expired after 3 attempts", exhaustion_sql)
        self.assertIn("attempts >= 3", exhaustion_sql)

    def test_schema_and_cli_keep_reasoning_review_only(self) -> None:
        root = Path(__file__).parents[3]
        migration = (
            root / "supabase/migrations/20260717192000_aggregate_reasoning_foundation.sql"
        ).read_text()
        main = (Path(__file__).parents[1] / "src/paper_classifier/main.py").read_text()
        repository = (
            Path(__file__).parents[1] / "src/paper_classifier/repository.py"
        ).read_text()

        self.assertIn("app.reasoning_jobs", migration)
        self.assertIn("app.reasoning_suggestions", migration)
        self.assertIn("review_status text NOT NULL DEFAULT 'needs_review'", migration)
        self.assertIn("auth.role() = 'service_role'", migration)
        self.assertIn("input_hash", migration)
        self.assertIn("prompt_version", migration)
        self.assertIn("lease_expires_at", migration)
        self.assertIn('"reason-system"', main)
        self.assertIn('"--execute"', main)
        self.assertIn("Preview only", main)
        self.assertIn("insert into app.reasoning_suggestions", repository)
        self.assertIn("lease_expires_at <= now()", repository)
        self.assertIn("Reasoning job lease expired after 3 attempts.", repository)
        self.assertIn("attempts = %(attempt)s", repository)
        self.assertIn("accepted_claim_closure", repository)
        self.assertNotIn("relevant_jobs as", repository)
        self.assertNotIn("update app.fmea", repository.lower())
        self.assertNotIn("update app.asset_component_instances", repository.lower())


if __name__ == "__main__":
    unittest.main()
