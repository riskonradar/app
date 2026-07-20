from __future__ import annotations

import unittest
from unittest.mock import MagicMock, patch

from paper_discovery.main import _backfill_oa
from paper_discovery.sources.openalex import OpenAlexRateLimitError


class OpenAccessBackfillTests(unittest.TestCase):
    @patch("paper_discovery.main.httpx.Client")
    @patch("paper_discovery.main.openalex.fetch_works_by_dois")
    @patch("paper_discovery.main.DiscoveryRepository")
    def test_batches_doi_lookups_and_updates_every_candidate(
        self,
        repository_type: MagicMock,
        fetch_works: MagicMock,
        client_type: MagicMock,
    ) -> None:
        candidates = [
            {"id": str(index), "doi": f"10.1000/{index}"}
            for index in range(201)
        ]
        repository = repository_type.return_value.__enter__.return_value
        repository.candidates_missing_oa.return_value = candidates
        client = client_type.return_value.__enter__.return_value

        def response_for(dois: list[str], *args: object, **kwargs: object):
            return {
                doi: {
                    "doi": f"https://doi.org/{doi}",
                    "open_access": {"is_oa": False},
                    "best_oa_location": {},
                    "cited_by_count": 3,
                }
                for doi in dois
            }

        fetch_works.side_effect = response_for

        _backfill_oa(201, False, "contact@example.com", "api-key")

        self.assertEqual(
            [len(call.args[0]) for call in fetch_works.call_args_list],
            [100, 100, 1],
        )
        self.assertTrue(
            all(
                call.args[1:3] == ("contact@example.com", "api-key")
                for call in fetch_works.call_args_list
            )
        )
        self.assertTrue(
            all(
                call.kwargs == {"client": client}
                for call in fetch_works.call_args_list
            )
        )
        self.assertEqual(repository.merge_discovery_metadata.call_count, 201)
        repository.merge_discovery_metadata.assert_any_call(
            "0",
            {"oa_checked": True, "is_oa": False, "cited_by_count": 3},
        )

    @patch("paper_discovery.main.httpx.Client")
    @patch("paper_discovery.main.openalex.fetch_works_by_dois")
    @patch("paper_discovery.main.DiscoveryRepository")
    def test_rate_limit_aborts_without_marking_candidates_checked(
        self,
        repository_type: MagicMock,
        fetch_works: MagicMock,
        client_type: MagicMock,
    ) -> None:
        repository = repository_type.return_value.__enter__.return_value
        repository.candidates_missing_oa.return_value = [
            {"id": "paper-id", "doi": "10.1000/example"}
        ]
        client_type.return_value.__enter__.return_value = object()
        fetch_works.side_effect = OpenAlexRateLimitError("daily allowance exhausted")

        with self.assertRaises(OpenAlexRateLimitError):
            _backfill_oa(1, False, "contact@example.com", "api-key")

        repository.merge_discovery_metadata.assert_not_called()


if __name__ == "__main__":
    unittest.main()
