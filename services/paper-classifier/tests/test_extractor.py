from __future__ import annotations

import unittest

from paper_classifier.extractor import classify_paper
from paper_classifier.keywords import KeywordTerm
from paper_classifier.llm import LlmConfig, _result_from_payload
from paper_classifier.models import ClaimType, Paper, SupportType


TEST_TAXONOMY_TERMS = (
    KeywordTerm("Bolt", ("bolt", "bolts"), ClaimType.COMPONENT),
    KeywordTerm("Fatigue", ("fatigue failure", "fatigue crack"), ClaimType.FAILURE_MODE),
    KeywordTerm("Crack / fracture", ("fracture", "fractured"), ClaimType.FAILURE_MODE),
    KeywordTerm("Corrosion / pitting", ("corrosion", "corrosion pits"), ClaimType.FAILURE_MODE),
)


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

        result = classify_paper(paper, TEST_TAXONOMY_TERMS)

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

        result = classify_paper(paper, TEST_TAXONOMY_TERMS)
        inferred = [
            claim
            for claim in result.claims
            if claim.support_type == SupportType.INFERRED_FROM_SPAN
            and claim.normalized_value == "corrosion fatigue"
        ]

        self.assertEqual(len(inferred), 1)
        self.assertTrue(inferred[0].spans)
        self.assertIsNotNone(inferred[0].inference_rationale)

    def test_closed_vocabulary_is_explicit_and_not_built_into_extractor(self) -> None:
        paper = Paper(
            id="paper-taxonomy-explicit",
            doi=None,
            title="Ball bearing low-cycle fatigue",
            abstract=None,
            journal=None,
            year=None,
            authors=None,
            url=None,
            source="test",
        )

        without_taxonomy = classify_paper(paper)
        with_taxonomy = classify_paper(
            paper,
            (
                KeywordTerm("Bearing", ("bearing",), ClaimType.COMPONENT),
                KeywordTerm("Ball Bearing", ("ball bearing",), ClaimType.COMPONENT),
                KeywordTerm("Fatigue", ("fatigue",), ClaimType.FAILURE_MODE),
                KeywordTerm(
                    "Low-cycle fatigue",
                    ("low cycle fatigue", "low-cycle fatigue"),
                    ClaimType.FAILURE_MODE,
                ),
            ),
        )

        self.assertFalse(
            any(
                claim.claim_type in {ClaimType.COMPONENT, ClaimType.FAILURE_MODE}
                for claim in without_taxonomy.claims
            )
        )
        canonical_values = {
            claim.normalized_value
            for claim in with_taxonomy.claims
            if claim.claim_type in {ClaimType.COMPONENT, ClaimType.FAILURE_MODE}
        }
        self.assertEqual(canonical_values, {"Ball Bearing", "Low-cycle fatigue"})
        self.assertEqual(with_taxonomy.metadata["taxonomy_term_count"], 4)

    def test_open_ended_heuristic_preserves_matched_source_phrase(self) -> None:
        paper = Paper(
            id="paper-specific-cause",
            doi=None,
            title="Lubrication investigation",
            abstract="The damage followed insufficient lubrication during startup.",
            journal=None,
            year=None,
            authors=None,
            url=None,
            source="test",
        )

        result = classify_paper(paper)
        causes = [
            claim for claim in result.claims if claim.claim_type == ClaimType.CAUSE
        ]

        self.assertEqual(len(causes), 1)
        self.assertEqual(causes[0].raw_value, "insufficient lubrication")
        self.assertEqual(causes[0].normalized_value, "insufficient lubrication")
        self.assertEqual(causes[0].metadata["heuristic_group"], "poor lubrication")

    def test_equal_alias_prefers_deeper_taxonomy_node(self) -> None:
        paper = Paper(
            id="paper-shared-alias",
            doi=None,
            title="Rolling bearing failure investigation",
            abstract=None,
            journal=None,
            year=None,
            authors=None,
            url=None,
            source="test",
        )

        result = classify_paper(
            paper,
            (
                KeywordTerm(
                    "Bearing",
                    ("rolling bearing",),
                    ClaimType.COMPONENT,
                    depth=1,
                ),
                KeywordTerm(
                    "Rolling Element Bearing",
                    ("rolling bearing",),
                    ClaimType.COMPONENT,
                    depth=2,
                ),
            ),
        )
        components = [
            claim for claim in result.claims if claim.claim_type == ClaimType.COMPONENT
        ]

        self.assertEqual(len(components), 1)
        self.assertEqual(components[0].normalized_value, "Rolling Element Bearing")
        self.assertEqual(components[0].raw_value, "Rolling bearing")

    def test_direct_corrosion_fatigue_is_not_duplicated_as_inference(self) -> None:
        paper = Paper(
            id="paper-direct-corrosion-fatigue",
            doi=None,
            title="Corrosion fatigue of a shaft",
            abstract=None,
            journal=None,
            year=None,
            authors=None,
            url=None,
            source="test",
        )

        result = classify_paper(
            paper,
            (
                KeywordTerm(
                    "Corrosion fatigue",
                    (),
                    ClaimType.FAILURE_MODE,
                    depth=1,
                ),
            ),
        )
        corrosion_fatigue = [
            claim
            for claim in result.claims
            if claim.normalized_value
            and claim.normalized_value.casefold() == "corrosion fatigue"
        ]

        self.assertEqual(len(corrosion_fatigue), 1)
        self.assertEqual(
            corrosion_fatigue[0].support_type,
            SupportType.DIRECT_SPAN,
        )

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
        self.assertEqual(result.claims[0].normalized_value, "shaft cracking")
        self.assertEqual(result.claims[0].spans[0].text, "cracked pump shaft")

    def test_llm_preserves_specific_failure_mode_for_taxonomy_linking(self) -> None:
        paper = Paper(
            id="paper-lcf",
            doi=None,
            title="Low-cycle fatigue of a turbine disk",
            abstract="Low-cycle fatigue initiated at the disk bore.",
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
                "confidence": 0.9,
                "claims": [
                    {
                        "claim_type": "failure_mode",
                        "raw_value": "Low-cycle fatigue",
                        "normalized_value": "low-cycle fatigue",
                        "support_type": "direct_span",
                        "confidence": 0.95,
                        "source_field": "abstract",
                        "evidence_text": "Low-cycle fatigue",
                    }
                ],
                "relationships": [],
            },
            LlmConfig(provider="test", model="test", api_key="test"),
        )

        self.assertEqual(len(result.claims), 1)
        self.assertEqual(result.claims[0].normalized_value, "low-cycle fatigue")

    def test_llm_failure_mode_uses_raw_value_when_normalized_value_is_missing(self) -> None:
        paper = Paper(
            id="paper-fallback",
            doi=None,
            title="Fretting fatigue in a spline coupling",
            abstract=None,
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
                        "raw_value": "Fretting fatigue",
                        "normalized_value": None,
                        "support_type": "direct_span",
                        "confidence": 0.9,
                        "source_field": "title",
                        "evidence_text": "Fretting fatigue",
                    }
                ],
                "relationships": [],
            },
            LlmConfig(provider="test", model="test", api_key="test"),
        )

        self.assertEqual(len(result.claims), 1)
        self.assertEqual(result.claims[0].normalized_value, "Fretting fatigue")

    def test_llm_span_match_tolerates_whitespace_differences(self) -> None:
        paper = Paper(
            id="paper-4",
            doi=None,
            title="Bearing failure study",
            abstract="The bearing failed due to\n  poor   lubrication under load.",
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
                        "claim_type": "cause",
                        "raw_value": "poor lubrication",
                        "normalized_value": "poor lubrication",
                        "support_type": "direct_span",
                        "confidence": 0.9,
                        "source_field": "abstract",
                        # single-spaced quote vs newline + double spaces in source
                        "evidence_text": "failed due to poor lubrication",
                    },
                ],
                "relationships": [],
            },
            LlmConfig(provider="test", model="test", api_key="test"),
        )

        self.assertEqual(len(result.claims), 1)
        span = result.claims[0].spans[0]
        # stored span must be the source's own slice, offsets included
        self.assertEqual(
            paper.abstract[span.char_start:span.char_end], span.text
        )
        self.assertIn("poor   lubrication", span.text)

    def test_llm_full_text_span_keeps_ingestion_provenance(self) -> None:
        paper = Paper(
            id="paper-full-text",
            doi="10.1000/full-text",
            title="Bearing investigation",
            abstract="The detailed mechanism is reported in the paper.",
            journal=None,
            year=2026,
            authors=None,
            url=None,
            source="test",
            full_text="Testing showed subsurface initiated rolling contact fatigue in the bearing race.",
            full_text_id="full-text-record-1",
            full_text_source_url="https://example.org/paper.pdf",
            full_text_license="cc-by",
            full_text_sha256="a" * 64,
        )

        result = _result_from_payload(
            paper,
            {
                "relevance": "relevant",
                "confidence": 0.9,
                "claims": [
                    {
                        "claim_type": "failure_mode",
                        "raw_value": "rolling contact fatigue",
                        "normalized_value": "rolling contact fatigue",
                        "support_type": "direct_span",
                        "confidence": 0.95,
                        "source_field": "full_text",
                        "evidence_text": "subsurface initiated rolling contact fatigue",
                    }
                ],
                "relationships": [],
            },
            LlmConfig(provider="test", model="test", api_key="test"),
        )

        self.assertEqual(len(result.claims), 1)
        span = result.claims[0].spans[0]
        self.assertEqual(span.source_field, "full_text")
        self.assertEqual(span.source_record_id, "full-text-record-1")
        self.assertEqual(paper.full_text[span.char_start:span.char_end], span.text)
        self.assertEqual(result.metadata["input_source"], "full_text")

    def test_llm_direct_relationship_requires_verified_quote(self) -> None:
        paper = Paper(
            id="paper-5",
            doi=None,
            title="Shaft fatigue caused by misalignment",
            abstract="Shaft fatigue was caused by coupling misalignment.",
            journal=None,
            year=None,
            authors=None,
            url=None,
            source="test",
        )
        claim = {
            "support_type": "direct_span",
            "confidence": 0.9,
            "source_field": "abstract",
        }
        payload = {
            "relevance": "relevant",
            "confidence": 0.8,
            "claims": [
                {**claim, "claim_type": "failure_mode", "raw_value": "shaft fatigue",
                 "normalized_value": "fatigue", "evidence_text": "Shaft fatigue"},
                {**claim, "claim_type": "cause", "raw_value": "coupling misalignment",
                 "normalized_value": "coupling misalignment", "evidence_text": "coupling misalignment"},
            ],
            "relationships": [
                {
                    "subject_claim_index": 0,
                    "relationship_type": "caused_by",
                    "object_claim_index": 1,
                    "support_type": "direct_span",
                    "confidence": 0.9,
                    "relationship_evidence_text": "fatigue was caused by coupling misalignment",
                },
                {
                    "subject_claim_index": 0,
                    "relationship_type": "caused_by",
                    "object_claim_index": 1,
                    "support_type": "direct_span",
                    "confidence": 0.9,
                    "relationship_evidence_text": "this quote is hallucinated",
                },
            ],
        }

        result = _result_from_payload(
            paper, payload, LlmConfig(provider="test", model="test", api_key="test")
        )

        self.assertEqual(len(result.claims), 2)
        self.assertEqual(len(result.relationships), 1)
        self.assertEqual(
            result.relationships[0].metadata["relationship_evidence_text"],
            "fatigue was caused by coupling misalignment",
        )

    def test_relationship_indices_remap_after_claim_drop(self) -> None:
        paper = Paper(
            id="paper-6",
            doi=None,
            title="Seal leakage from worn faces",
            abstract="Seal leakage occurred because the seal faces were worn.",
            journal=None,
            year=None,
            authors=None,
            url=None,
            source="test",
        )
        base = {"support_type": "direct_span", "confidence": 0.9, "source_field": "abstract"}
        payload = {
            "relevance": "relevant",
            "confidence": 0.8,
            "claims": [
                {**base, "claim_type": "failure_mode", "raw_value": "seal leakage",
                 "normalized_value": "leakage", "evidence_text": "Seal leakage"},
                # this middle claim is dropped by the span gate (hallucinated quote)
                {**base, "claim_type": "effect", "raw_value": "fire",
                 "normalized_value": "fire", "evidence_text": "not in the source at all"},
                {**base, "claim_type": "cause", "raw_value": "worn seal faces",
                 "normalized_value": "worn seal faces", "evidence_text": "seal faces were worn"},
            ],
            "relationships": [
                # refers to ORIGINAL indices 0 and 2; after the drop the cause is
                # at surviving index 1 — the edge must remap, not misattach or die
                {
                    "subject_claim_index": 0,
                    "relationship_type": "caused_by",
                    "object_claim_index": 2,
                    "support_type": "inferred_from_span",
                    "confidence": 0.8,
                    "relationship_evidence_text": "Seal leakage occurred because the seal faces were worn",
                    "inference_rationale": "leakage attributed to worn faces",
                },
                # refers to the dropped claim — must be discarded
                {
                    "subject_claim_index": 0,
                    "relationship_type": "has_effect",
                    "object_claim_index": 1,
                    "support_type": "inferred_from_span",
                    "confidence": 0.8,
                    "relationship_evidence_text": "Seal leakage occurred",
                    "inference_rationale": "should not survive",
                },
            ],
        }

        result = _result_from_payload(
            paper, payload, LlmConfig(provider="test", model="test", api_key="test")
        )

        self.assertEqual(len(result.claims), 2)
        self.assertEqual(len(result.relationships), 1)
        rel = result.relationships[0]
        self.assertEqual(result.claims[rel.subject_index].claim_type, ClaimType.FAILURE_MODE)
        self.assertEqual(result.claims[rel.object_index].claim_type, ClaimType.CAUSE)
        self.assertEqual(result.claims[rel.object_index].raw_value, "worn seal faces")


if __name__ == "__main__":
    unittest.main()
