from __future__ import annotations

import os
import sys
import unittest
from unittest.mock import patch

from paper_discovery.main import main


class DiscoveryCliTests(unittest.TestCase):
    def test_write_run_requires_openalex_api_key(self) -> None:
        with (
            patch.dict(os.environ, {"DATABASE_URL": "unused"}, clear=True),
            patch.object(sys, "argv", ["paper-discovery", "--limit", "1"]),
            self.assertRaises(SystemExit) as raised,
        ):
            main()

        self.assertEqual(
            str(raised.exception),
            "Set OPENALEX_API_KEY before running production discovery or OA backfills.",
        )


if __name__ == "__main__":
    unittest.main()
