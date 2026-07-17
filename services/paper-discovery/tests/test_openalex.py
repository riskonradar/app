from __future__ import annotations

import unittest

from paper_discovery.sources.openalex import _paper_from_item, license_url_for


class OpenAlexMappingTests(unittest.TestCase):
    def test_best_oa_pdf_and_license_provenance_are_preserved(self) -> None:
        paper = _paper_from_item(
            {
                "id": "https://openalex.org/W1",
                "doi": "https://doi.org/10.1000/oa",
                "title": "Open bearing failure paper",
                "authorships": [],
                "primary_location": {"source": {"display_name": "Journal"}},
                "publication_year": 2026,
                "open_access": {
                    "is_oa": True,
                    "oa_status": "gold",
                    "oa_url": "https://example.org/landing",
                },
                "best_oa_location": {
                    "pdf_url": "https://example.org/paper.pdf",
                    "license": "cc-by",
                    "version": "publishedVersion",
                },
                "cited_by_count": 4,
            }
        )

        self.assertIsNotNone(paper)
        self.assertEqual(paper.oa_url, "https://example.org/paper.pdf")
        self.assertEqual(paper.oa_license, "cc-by")
        self.assertEqual(paper.oa_version, "publishedVersion")
        self.assertEqual(
            paper.oa_license_url,
            "https://creativecommons.org/licenses/by/4.0/",
        )

    def test_noncommercial_license_has_no_invented_license_url(self) -> None:
        self.assertIsNone(license_url_for("cc-by-nc"))


if __name__ == "__main__":
    unittest.main()
