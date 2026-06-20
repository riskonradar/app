from __future__ import annotations

import unittest

from paper_discovery.dedupe import abstract_hash, canonicalize_doi, first_author, title_fingerprint
from paper_discovery.models import DiscoveredPaper


class DedupeTests(unittest.TestCase):
    def test_canonicalize_doi(self) -> None:
        self.assertEqual(
            canonicalize_doi("https://doi.org/10.1016/J.ENGFAILANAL.2024.108255."),
            "10.1016/j.engfailanal.2024.108255",
        )
        self.assertEqual(canonicalize_doi("doi: 10.1000/ABC"), "10.1000/abc")
        self.assertIsNone(canonicalize_doi(""))

    def test_title_fingerprint_ignores_punctuation_and_case(self) -> None:
        self.assertEqual(
            title_fingerprint("Failure analysis of M20-class bolt fracture"),
            title_fingerprint("failure analysis of M20 class bolt fracture"),
        )
        self.assertEqual(
            title_fingerprint("Café bearing failure"),
            title_fingerprint("cafe bearing failure"),
        )

    def test_abstract_hash_normalizes_spacing(self) -> None:
        self.assertEqual(
            abstract_hash("The bearing failed after cyclic loading."),
            abstract_hash(" the   bearing failed after cyclic loading. "),
        )
        self.assertEqual(
            abstract_hash("Résumé of fatigue effects"),
            abstract_hash("resume of fatigue effects"),
        )

    def test_discovered_paper_dedupe_properties(self) -> None:
        paper = DiscoveredPaper(
            doi="https://doi.org/10.1000/XYZ",
            title="Fatigue Failure of Structural Bolts",
            abstract="A bolt failed after repeated loading.",
            authors=["Ada Lovelace", "Grace Hopper"],
            journal="Engineering Failure Analysis",
            year=2024,
            source_url="https://doi.org/10.1000/XYZ",
        )

        self.assertEqual(paper.canonical_doi, "10.1000/xyz")
        self.assertEqual(paper.first_author, first_author(["Ada Lovelace"]))
        self.assertTrue(paper.title_fingerprint)
        self.assertTrue(paper.abstract_hash)


if __name__ == "__main__":
    unittest.main()
