from __future__ import annotations

import unittest
from pathlib import Path


ROOT = Path(__file__).parents[3]


class RemovedEvidenceContractTests(unittest.TestCase):
    def test_failure_mode_search_and_browser_exclude_removed_sources(self) -> None:
        sql = (
            ROOT
            / "supabase/migrations/20260717170000_failure_mode_taxonomy_search.sql"
        ).read_text(encoding="utf-8")

        self.assertGreaterEqual(sql.count("lifecycle_status <> 'removed'"), 4)

    def test_fmea_lineage_and_persistence_exclude_removed_sources(self) -> None:
        sql = (
            ROOT
            / "supabase/migrations/20260717160000_transactional_fmea_saves.sql"
        ).read_text(encoding="utf-8")

        self.assertIn("source_paper.lifecycle_status <> 'removed'", sql)
        self.assertIn("paper.lifecycle_status <> 'removed'", sql)
        self.assertIn("validated_paper.lifecycle_status <> 'removed'", sql)

    def test_reasoning_uses_bounded_accepted_closure_and_excludes_removed_sources(self) -> None:
        repository = (
            ROOT
            / "services/paper-classifier/src/paper_classifier/repository.py"
        ).read_text(encoding="utf-8")

        self.assertIn("accepted_claim_closure", repository)
        self.assertIn("where closure.depth < 6", repository)
        self.assertIn("limit %(root_limit)s", repository)
        self.assertIn("limit %(claim_limit)s", repository)
        self.assertNotIn("relevant_jobs as", repository)
        self.assertIn("evidence_paper.lifecycle_status <> 'removed'", repository)
        self.assertIn("propagation_paper.lifecycle_status <> 'removed'", repository)
        self.assertIn("paper.lifecycle_status <> 'removed'", repository)


if __name__ == "__main__":
    unittest.main()
