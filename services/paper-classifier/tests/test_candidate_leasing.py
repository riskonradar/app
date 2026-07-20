from __future__ import annotations

import unittest
from contextlib import nullcontext
from typing import Any

from paper_classifier.repository import CandidateLeaseLostError, PostgresRepository


class _Result:
    def __init__(self, rows: list[dict[str, Any]] | None = None) -> None:
        self.rows = rows or []

    def fetchall(self) -> list[dict[str, Any]]:
        return self.rows

    def fetchone(self) -> dict[str, Any] | None:
        return self.rows[0] if self.rows else None


class _Connection:
    def __init__(self, rows: list[dict[str, Any]]) -> None:
        self.rows = rows
        self.calls: list[tuple[str, dict[str, Any]]] = []

    def transaction(self) -> Any:
        return nullcontext()

    def execute(self, query: str, params: dict[str, Any]) -> _Result:
        self.calls.append((query, params))
        if "classification_lease_token = %(lease_token)s::uuid" in query and "select" in query.lower():
            token = params["lease_token"]
            return _Result([{**row, "lease_token": token} for row in self.rows])
        return _Result()


def _candidate_row() -> dict[str, Any]:
    return {
        "id": "candidate-1",
        "doi": None,
        "title": "Bearing fatigue",
        "abstract": "The bearing failed.",
        "journal": None,
        "publication_year": 2026,
        "authors": [],
        "source_url": None,
        "source": "test",
        "full_text_id": None,
        "full_text": None,
        "full_text_source_url": None,
        "full_text_license": None,
        "full_text_sha256": None,
    }


class CandidateLeasingTests(unittest.TestCase):
    def test_pending_batch_is_claimed_with_skip_locked_and_expiry(self) -> None:
        repository = PostgresRepository("postgresql://unused")
        connection = _Connection([_candidate_row()])
        repository.connection = connection  # type: ignore[assignment]

        candidates = repository.pending_candidates(10, "classifier-v1")

        self.assertEqual(len(candidates), 1)
        self.assertIsNotNone(candidates[0].lease_token)
        claim_sql = connection.calls[0][0].lower()
        self.assertIn("for update of pc skip locked", claim_sql)
        self.assertIn("classification_lease_expires_at", claim_sql)
        self.assertIn("make_interval", claim_sql)

    def test_dry_run_selection_does_not_write_a_lease(self) -> None:
        repository = PostgresRepository("postgresql://unused")
        connection = _Connection([_candidate_row()])
        repository.connection = connection  # type: ignore[assignment]

        repository.pending_candidates(10, "classifier-v1", claim_lease=False)

        self.assertEqual(len(connection.calls), 1)
        self.assertNotIn("update papers_raw.paper_candidates", connection.calls[0][0].lower())

    def test_lost_lease_fails_closed(self) -> None:
        repository = PostgresRepository("postgresql://unused")
        connection = _Connection([])
        repository.connection = connection  # type: ignore[assignment]
        candidate = repository.pending_candidates(1, "classifier-v1", claim_lease=False)
        self.assertEqual(candidate, [])

        from paper_classifier.repository import CandidatePaper

        with self.assertRaises(CandidateLeaseLostError):
            repository._require_candidate_lease(
                CandidatePaper(
                    id="candidate-1",
                    doi=None,
                    title="Bearing fatigue",
                    abstract="The bearing failed.",
                    journal=None,
                    publication_year=2026,
                    authors=[],
                    source_url=None,
                    source="test",
                    lease_token="00000000-0000-4000-8000-000000000001",
                )
            )


if __name__ == "__main__":
    unittest.main()
