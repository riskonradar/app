from __future__ import annotations

import unittest
from unittest.mock import patch

from paper_discovery.journals import Journal
from paper_discovery.main import DiscoverySweepError, SourceCallResult, _run_discovery


class DiscoveryObservabilityTests(unittest.TestCase):
    @patch("paper_discovery.main._fetch_and_store")
    def test_partial_openalex_failure_remains_tolerated(self, fetch: object) -> None:
        fetch.side_effect = [  # type: ignore[attr-defined]
            SourceCallResult(2, source_succeeded=True),
            SourceCallResult(0, source_succeeded=False),
        ]

        _run_discovery(
            (Journal("Journal", "1234-5678"),),
            ("fatigue", "corrosion"),
            10,
            True,
            None,
            None,
        )

    @patch("paper_discovery.main._fetch_and_store")
    def test_entire_openalex_outage_exits_nonzero(self, fetch: object) -> None:
        fetch.return_value = SourceCallResult(0, source_succeeded=False)  # type: ignore[attr-defined]

        with self.assertRaisesRegex(DiscoverySweepError, "all OpenAlex"):
            _run_discovery(
                (Journal("Journal", "1234-5678"),),
                ("fatigue",),
                10,
                True,
                None,
                None,
            )

    @patch("paper_discovery.main._fetch_and_store")
    def test_database_write_failure_exits_nonzero(self, fetch: object) -> None:
        fetch.return_value = SourceCallResult(0, source_succeeded=True, db_write_failed=True)  # type: ignore[attr-defined]

        with self.assertRaisesRegex(DiscoverySweepError, "failed to persist"):
            _run_discovery(
                (Journal("Journal", "1234-5678"),),
                ("fatigue",),
                10,
                False,
                None,
                None,
            )


if __name__ == "__main__":
    unittest.main()
