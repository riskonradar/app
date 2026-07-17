from __future__ import annotations

import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

from paper_classifier.extractor import CLASSIFIER_VERSION as KEYWORD_CLASSIFIER_VERSION
from paper_classifier.keywords import KeywordTerm
from paper_classifier.llm import LlmConfig, LlmExtractorError
from paper_classifier.main import _classify_batch, _extract_with_provenance
from paper_classifier.models import ClaimType, ClassificationResult, Paper
from paper_classifier.repository import CandidatePaper, paper_from_candidate


MIGRATION = (
    Path(__file__).parents[3]
    / "supabase"
    / "migrations"
    / "20260717150000_retire_legacy_paper_classifications.sql"
)
PIPELINE_ROLE_MIGRATION = (
    Path(__file__).parents[3]
    / "supabase"
    / "migrations"
    / "20260717193000_pipeline_runtime_role.sql"
)


def _paper() -> Paper:
    return Paper(
        id="paper-1",
        doi="10.1000/example",
        title="Bearing fatigue",
        abstract="The bearing failed under cyclic loading.",
        journal=None,
        year=2026,
        authors=None,
        url=None,
        source="test",
    )


def _result(extractor: str) -> ClassificationResult:
    return ClassificationResult(
        relevance="relevant",
        confidence=0.9,
        claims=(),
        relationships=(),
        metadata={"extractor": extractor},
    )


class PipelineHygieneTests(unittest.TestCase):
    def test_keyword_batch_loads_taxonomy_terms_once_and_reuses_them(self) -> None:
        candidate = CandidatePaper(
            id="candidate-1",
            doi=None,
            title="Bearing fatigue",
            abstract="The bearing failed under cyclic loading.",
            journal=None,
            publication_year=2026,
            authors=[],
            source_url=None,
            source="test",
        )
        taxonomy_terms = (
            KeywordTerm("Bearing", ("bearing",), ClaimType.COMPONENT),
        )
        repository = MagicMock()
        repository.__enter__.return_value = repository
        repository.__exit__.return_value = None
        repository.pending_candidates.return_value = [candidate]
        repository.active_taxonomy_terms.return_value = taxonomy_terms

        with (
            patch("paper_classifier.main.PostgresRepository", return_value=repository),
            patch(
                "paper_classifier.main.classify_paper",
                return_value=_result("deterministic keyword/span preprocessor"),
            ) as keyword_extractor,
        ):
            outcome = _classify_batch(
                limit=10,
                mode="incremental",
                classifier_version=KEYWORD_CLASSIFIER_VERSION,
                extractor="keyword",
                llm_config=None,
                dry_run=True,
                workers=1,
                topic_filter=None,
            )

        self.assertEqual(outcome.succeeded, 1)
        repository.active_taxonomy_terms.assert_called_once_with()
        keyword_extractor.assert_called_once_with(
            paper_from_candidate(candidate),
            taxonomy_terms,
        )

    def test_auto_fallback_uses_keyword_version_and_preserves_llm_error(self) -> None:
        llm_error = LlmExtractorError("provider unavailable")
        keyword_result = _result("deterministic keyword/span preprocessor")
        taxonomy_terms = (
            KeywordTerm("Bearing", ("bearing",), ClaimType.COMPONENT),
        )

        with (
            patch("paper_classifier.main.extract_with_llm", side_effect=llm_error),
            patch(
                "paper_classifier.main.classify_paper",
                return_value=keyword_result,
            ) as keyword_extractor,
        ):
            result, version, failure = _extract_with_provenance(
                _paper(),
                "auto",
                LlmConfig(provider="test", model="test-model", api_key="test"),
                "llm-extractor-v5:test:test-model",
                taxonomy_terms,
            )

        self.assertIs(result, keyword_result)
        self.assertEqual(version, KEYWORD_CLASSIFIER_VERSION)
        self.assertIs(failure, llm_error)
        keyword_extractor.assert_called_once_with(_paper(), taxonomy_terms)

    def test_llm_only_mode_never_falls_back(self) -> None:
        llm_error = LlmExtractorError("provider unavailable")

        with (
            patch("paper_classifier.main.extract_with_llm", side_effect=llm_error),
            patch("paper_classifier.main.classify_paper") as keyword_extractor,
            self.assertRaises(LlmExtractorError),
        ):
            _extract_with_provenance(
                _paper(),
                "llm",
                LlmConfig(provider="test", model="test-model", api_key="test"),
                "llm-extractor-v5:test:test-model",
            )

        keyword_extractor.assert_not_called()

    def test_legacy_coarse_classification_table_is_formally_retired(self) -> None:
        repository_source = (
            Path(__file__).parents[1]
            / "src"
            / "paper_classifier"
            / "repository.py"
        ).read_text(encoding="utf-8")
        migration = MIGRATION.read_text(encoding="utf-8")

        self.assertNotIn("insert into knowledge.paper_classifications", repository_source)
        self.assertIn("REVOKE ALL ON TABLE knowledge.paper_classifications", migration)
        self.assertIn("RETIRED: legacy coarse classification summary", migration)
        self.assertNotIn("DROP TABLE", migration.upper())

    def test_completed_jobs_are_immutable_and_keyword_runs_preserve_llm_claims(self) -> None:
        repository_source = (
            Path(__file__).parents[1]
            / "src"
            / "paper_classifier"
            / "repository.py"
        ).read_text(encoding="utf-8")

        self.assertIn(
            "where knowledge.classification_jobs.status <> 'completed'",
            repository_source,
        )
        self.assertNotIn(
            "delete from knowledge.evidence_claims where classification_job_id",
            repository_source,
        )
        self.assertIn("%(new_is_llm)s", repository_source)
        self.assertIn(
            "coalesce(previous_job.classifier_metadata->>'extractor', '') <> 'llm'",
            repository_source,
        )

    def test_pipeline_role_uses_explicit_rls_without_delete_or_bypass(self) -> None:
        migration = PIPELINE_ROLE_MIGRATION.read_text(encoding="utf-8")

        self.assertNotIn("BYPASSRLS", migration)
        self.assertIn('CREATE POLICY "pipeline runtime access"', migration)
        self.assertIn("TO riskonradar_pipeline", migration)
        self.assertIn("GRANT SELECT, INSERT, UPDATE ON TABLE", migration)
        self.assertNotIn("GRANT SELECT, INSERT, UPDATE, DELETE", migration)


if __name__ == "__main__":
    unittest.main()
