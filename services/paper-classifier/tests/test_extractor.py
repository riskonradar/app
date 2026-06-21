from __future__ import annotations

import unittest

from paper_classifier.extractor import classify_paper
from paper_classifier.llm import LlmConfig, _result_from_payload
from paper_classifier.models import ClaimType, Paper, SupportType


class ExtractorTests(unittest.TestCase):
    def test_extracts_direct_claims_with_spans(self) -> None:
        paper = Paper(
            id="paper-1",
            doi="10.1000/example",
            title="Failure Analysis of Fatigue Failed Galvanized Steel Bolt",
            abstract="The bolt fractured after cyclic loading in a marine environment.",
            journal="Engineering Failure Analysis",
            year=2024,
            authors=None,
            url=None,
            source="test",
        )

        result = classify_paper(paper)

        component_claims = [claim for claim in result.claims if claim.claim_type == ClaimType.COMPONENT]
        failure_claims = [claim for claim in result.claims if claim.claim_type == ClaimType.FAILURE_MODE]

        self.assertTrue(component_claims)
        self.assertTrue(failure_claims)
        self.assertTrue(all(claim.spans for claim in component_claims + failure_claims))
        self.assertTrue(all(claim.support_type == SupportType.DIRECT_SPAN for claim in component_claims[:1]))

    def test_inferred_claims_are_marked_and_supported_by_spans(self) -> None:
        paper = Paper(
            id="paper-2",
            doi=None,
            title="Corrosion and fatigue failure of offshore bolts",
            abstract="Corrosion pits were observed near fatigue crack initiation sites.",
            journal=None,
            year=None,
            authors=None,
            url=None,
            source="test",
        )

        result = classify_paper(paper)
        inferred = [
            claim
            for claim in result.claims
            if claim.support_type == SupportType.INFERRED_FROM_SPAN
            and claim.normalized_value == "Fatigue"
        ]

        self.assertEqual(len(inferred), 1)
        self.assertTrue(inferred[0].spans)
        self.assertIsNotNone(inferred[0].inference_rationale)

    def test_llm_claim_requires_exact_source_span(self) -> None:
        paper = Paper(
            id="paper-3",
            doi=None,
            title="Failure analysis of cracked pump shaft",
            abstract="The shaft failed after repeated loading.",
            journal=None,
            year=None,
            authors=None,
            url=None,
            source="test",
        )

        result = _result_from_payload(
            paper,
            {
                "relevance": "relevant",
                "confidence": 0.8,
                "claims": [
                    {
                        "claim_type": "failure_mode",
                        "raw_value": "cracked shaft",
                        "normalized_value": "shaft cracking",
                        "support_type": "direct_span",
                        "confidence": 0.9,
                        "source_field": "title",
                        "evidence_text": "cracked pump shaft",
                    },
                    {
                        "claim_type": "cause",
                        "raw_value": "unsupported hallucinated cause",
                        "normalized_value": "unsupported hallucinated cause",
                        "support_type": "direct_span",
                        "confidence": 0.9,
                        "source_field": "abstract",
                        "evidence_text": "not actually in the abstract",
                    },
                ],
                "relationships": [],
            },
            LlmConfig(provider="test", model="test", api_key="test"),
        )

        self.assertEqual(len(result.claims), 1)
        self.assertEqual(result.claims[0].normalized_value, "Crack / fracture")
        self.assertEqual(result.claims[0].spans[0].text, "cracked pump shaft")


if __name__ == "__main__":
    unittest.main()
