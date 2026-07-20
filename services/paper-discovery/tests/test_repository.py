from __future__ import annotations

import unittest
from contextlib import nullcontext
from typing import Any
from unittest.mock import Mock

from paper_discovery.models import DiscoveredPaper
from paper_discovery.repository import DiscoveryRepository


class _Result:
    def __init__(self, row: dict[str, Any] | None) -> None:
        self.row = row

    def fetchone(self) -> dict[str, Any] | None:
        return self.row


class _Connection:
    def __init__(self, row: dict[str, Any] | None = None) -> None:
        self.row = row
        self.queries: list[str] = []

    def execute(self, query: str, params: dict[str, Any]) -> _Result:
        self.queries.append(query)
        return _Result(self.row)

    def transaction(self) -> Any:
        return nullcontext()


def _paper() -> DiscoveredPaper:
    return DiscoveredPaper(
        doi="10.1000/example",
        title="Bearing fatigue",
        abstract="The bearing failed under cyclic loading.",
        authors=["Ada Engineer"],
        journal="Engineering Failure Analysis",
        year=2026,
        source_url="https://doi.org/10.1000/example",
    )


class DiscoveryRepositoryTests(unittest.TestCase):
    def test_batch_writes_run_in_an_explicit_transaction(self) -> None:
        repository = DiscoveryRepository("postgresql://unused")
        connection = _Connection()
        repository.connection = connection  # type: ignore[assignment]
        repository._find_existing_candidate = Mock(return_value=None)  # type: ignore[method-assign]
        repository._insert_paper = Mock(return_value=True)  # type: ignore[method-assign]

        transaction = Mock(return_value=nullcontext())
        connection.transaction = transaction  # type: ignore[method-assign]

        stats = repository.upsert_papers("run-1", [_paper()])

        self.assertEqual(stats.inserted, 1)
        transaction.assert_called_once_with()

    def test_insert_uses_doi_conflict_guard(self) -> None:
        repository = DiscoveryRepository("postgresql://unused")
        connection = _Connection(row=None)
        repository.connection = connection  # type: ignore[assignment]

        inserted = repository._insert_paper("run-1", _paper())

        self.assertFalse(inserted)
        self.assertIn("on conflict (doi) do nothing", connection.queries[0])
        self.assertIn("returning id", connection.queries[0])

    def test_concurrent_insert_is_reloaded_and_counted_as_existing(self) -> None:
        repository = DiscoveryRepository("postgresql://unused")
        repository.connection = _Connection()  # type: ignore[assignment]
        existing = {
            "id": "paper-1",
            "title": "Bearing fatigue",
            "abstract": "The bearing failed under cyclic loading.",
            "classification_status": "pending",
            "lifecycle_status": "pending_classification",
        }
        repository._find_existing_candidate = Mock(  # type: ignore[method-assign]
            side_effect=[None, existing]
        )
        repository._insert_paper = Mock(return_value=False)  # type: ignore[method-assign]
        repository._update_paper = Mock(return_value=False)  # type: ignore[method-assign]

        stats = repository.upsert_papers("run-1", [_paper()])

        self.assertEqual(stats.inserted, 0)
        self.assertEqual(stats.updated, 0)
        self.assertEqual(stats.unchanged, 1)
        self.assertEqual(repository._find_existing_candidate.call_count, 2)


if __name__ == "__main__":
    unittest.main()
