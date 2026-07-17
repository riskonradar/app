from __future__ import annotations

import unittest
from contextlib import nullcontext
from pathlib import Path
from typing import Any

from paper_classifier.main import _taxonomy_link_summary
from paper_classifier.models import ClaimType
from paper_classifier.repository import PostgresRepository, TAXONOMY_LINKERS


MIGRATION = (
    Path(__file__).parents[3]
    / "supabase"
    / "migrations"
    / "20260717120000_extend_evidence_taxonomies.sql"
)


class _Result:
    def __init__(self, linked: int) -> None:
        self.linked = linked

    def fetchone(self) -> dict[str, int]:
        return {"linked": self.linked}


class _Connection:
    def __init__(self) -> None:
        self.calls: list[tuple[str, dict[str, Any]]] = []
        self.link_calls = 0

    def transaction(self) -> Any:
        return nullcontext()

    def execute(
        self, query: str, params: dict[str, Any] | None = None
    ) -> _Result:
        params = params or {}
        self.calls.append((query, params))
        if "set_config" in query:
            return _Result(0)
        self.link_calls += 1
        return _Result(self.link_calls)


class _RowsResult:
    def __init__(self, rows: list[dict[str, Any]]) -> None:
        self.rows = rows

    def fetchall(self) -> list[dict[str, Any]]:
        return self.rows


class _TaxonomyConnection:
    def __init__(self) -> None:
        self.calls: list[str] = []

    def execute(
        self, query: str, params: dict[str, Any] | None = None
    ) -> _RowsResult:
        self.calls.append(query)
        return _RowsResult(
            [
                {
                    "claim_type": "component",
                    "name": "Ball Bearing",
                    "aliases": ["ball bearing", "Ball Bearing", "ball bearings"],
                    "depth": 3,
                },
                {
                    "claim_type": "failure_mode",
                    "name": "Low-cycle fatigue",
                    "aliases": ["lcf", "low cycle fatigue"],
                    "depth": 1,
                },
                {
                    "claim_type": "analysis_method",
                    "name": "Finite element analysis",
                    "aliases": ["fea"],
                    "depth": 1,
                },
                {
                    "claim_type": "application",
                    "name": "Aviation",
                    "aliases": ["aircraft"],
                    "depth": 1,
                },
            ]
        )


class TaxonomyLinkingTests(unittest.TestCase):
    def test_repository_loads_all_active_closed_vocabularies_once(self) -> None:
        repository = PostgresRepository("postgresql://unused")
        connection = _TaxonomyConnection()
        repository.connection = connection  # type: ignore[assignment]

        terms = repository.active_taxonomy_terms()

        self.assertEqual(len(connection.calls), 1)
        query = connection.calls[0]
        for table in (
            "knowledge.components",
            "knowledge.failure_modes",
            "knowledge.analysis_methods",
            "knowledge.applications",
        ):
            self.assertIn(table, query)
        self.assertEqual(query.count("where is_active = true"), 4)
        self.assertEqual(
            [term.claim_type for term in terms],
            [
                ClaimType.COMPONENT,
                ClaimType.FAILURE_MODE,
                ClaimType.ANALYSIS_METHOD,
                ClaimType.APPLICATION,
            ],
        )
        self.assertEqual(terms[0].normalized, "Ball Bearing")
        self.assertEqual(terms[0].depth, 3)
        self.assertEqual(
            terms[0].aliases,
            ("ball bearings", "Ball Bearing"),
        )

    def test_repository_runs_every_taxonomy_linker_in_order(self) -> None:
        repository = PostgresRepository("postgresql://unused")
        connection = _Connection()
        repository.connection = connection  # type: ignore[assignment]

        counts = repository.link_taxonomy(dry_run=True)

        self.assertEqual(list(counts), [label for label, _ in TAXONOMY_LINKERS])
        self.assertEqual(list(counts.values()), [1, 2, 3, 4])
        self.assertEqual(len(connection.calls), len(TAXONOMY_LINKERS) + 1)
        self.assertIn("request.jwt.claim.role", connection.calls[0][0])
        for (query, params), (_, function) in zip(connection.calls[1:], TAXONOMY_LINKERS):
            self.assertIn(function, query)
            self.assertEqual(params, {"dry_run": True})

    def test_summary_includes_all_linked_claim_types(self) -> None:
        summary = _taxonomy_link_summary(
            {"analysis_methods": 4, "applications": 2}
        )

        self.assertEqual(
            summary,
            "4 analysis-methods claim(s), 2 applications claim(s)",
        )

    def test_migration_uses_the_shared_secure_linking_pattern(self) -> None:
        sql = MIGRATION.read_text(encoding="utf-8")
        selected = {
            "analysis_method": "analysis_method",
            "application": "application",
        }

        for claim_type, name in selected.items():
            self.assertIn(f"knowledge.link_{name}_claims", sql)
            self.assertIn(f"ec.claim_type = '{claim_type}'", sql)
            self.assertIn(f"knowledge.claim_{name}_links", sql)
            self.assertIn(f"link_{name}_claims requires service_role", sql)

        self.assertEqual(sql.count("v_threshold numeric := 0.45;"), len(selected))
        self.assertEqual(
            sql.count("auth.role() IS DISTINCT FROM 'service_role'"), len(selected)
        )
        self.assertEqual(
            sql.count("LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog"),
            len(selected),
        )
        self.assertNotIn("UPDATE KNOWLEDGE.EVIDENCE_CLAIMS", sql.upper())

    def test_unselected_claim_types_are_not_added_to_the_inbox(self) -> None:
        sql = MIGRATION.read_text(encoding="utf-8")

        for claim_type in (
            "cause",
            "effect",
            "control",
            "corrective_action",
            "operating_context",
            "maintenance_action",
            "environment",
            "detection_method",
            "material",
        ):
            self.assertNotIn(f"ec.claim_type = '{claim_type}'", sql)


if __name__ == "__main__":
    unittest.main()
