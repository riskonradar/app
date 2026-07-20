from __future__ import annotations

import os
import unittest
from unittest.mock import MagicMock, patch

from paper_classifier.main import BatchOutcome, _ping_classifier_healthcheck


class ClassifierObservabilityTests(unittest.TestCase):
    @patch.dict(os.environ, {}, clear=True)
    @patch("paper_classifier.main.urllib.request.urlopen")
    def test_healthcheck_is_noop_when_env_is_absent(self, urlopen: MagicMock) -> None:
        self.assertFalse(_ping_classifier_healthcheck())
        urlopen.assert_not_called()

    @patch("paper_classifier.main.urllib.request.urlopen")
    def test_healthcheck_pings_configured_url(self, urlopen: MagicMock) -> None:
        response = MagicMock()
        response.__enter__.return_value = response
        response.read.return_value = b""
        urlopen.return_value = response

        self.assertTrue(_ping_classifier_healthcheck("https://hc.example.test/ping"))

        request = urlopen.call_args.args[0]
        self.assertEqual(request.full_url, "https://hc.example.test/ping")
        self.assertEqual(urlopen.call_args.kwargs["timeout"], 10)

    @patch("paper_classifier.main.urllib.request.urlopen")
    def test_healthcheck_marks_failed_batches(self, urlopen: MagicMock) -> None:
        response = MagicMock()
        response.__enter__.return_value = response
        response.read.return_value = b""
        urlopen.return_value = response

        self.assertTrue(
            _ping_classifier_healthcheck(
                "https://hc.example.test/ping/",
                success=False,
            )
        )
        request = urlopen.call_args.args[0]
        self.assertEqual(request.full_url, "https://hc.example.test/ping/fail")

    def test_batch_health_threshold_catches_provider_and_taxonomy_failures(self) -> None:
        self.assertTrue(BatchOutcome(selected=2, failed=2).unhealthy)
        self.assertTrue(
            BatchOutcome(selected=2, succeeded=2, fallbacks=1).unhealthy
        )
        self.assertTrue(
            BatchOutcome(selected=1, succeeded=1, taxonomy_failed=True).unhealthy
        )
        self.assertFalse(BatchOutcome(selected=3, succeeded=3).unhealthy)


if __name__ == "__main__":
    unittest.main()
