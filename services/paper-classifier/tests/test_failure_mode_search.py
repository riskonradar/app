from __future__ import annotations

import unittest
from pathlib import Path


MIGRATION = (
    Path(__file__).parents[3]
    / "supabase"
    / "migrations"
    / "20260717170000_failure_mode_taxonomy_search.sql"
)


class FailureModeSearchMigrationTests(unittest.TestCase):
    def test_failure_mode_search_and_browser_are_hardened_and_taxonomy_backed(self) -> None:
        sql = MIGRATION.read_text(encoding="utf-8")

        self.assertIn("public.search_fmea_by_failure_mode", sql)
        self.assertIn("public.get_failure_mode_taxonomy", sql)
        self.assertIn("knowledge.claim_failure_mode_links", sql)
        self.assertIn(
            "failure_node.path LIKE failure_target.path || '/%'",
            sql,
        )
        self.assertEqual(sql.count("SECURITY DEFINER"), 5)
        self.assertEqual(sql.count("SET search_path = pg_catalog"), 5)
        self.assertIn("auth.role() IN ('authenticated', 'service_role')", sql)
        self.assertIn("FROM PUBLIC, anon", sql)


if __name__ == "__main__":
    unittest.main()
