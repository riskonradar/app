from __future__ import annotations

import unittest

import httpx

from paper_discovery.sources.openalex import (
    _get_with_backoff,
    _paper_from_item,
    fetch_work_by_doi,
    license_url_for,
)


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


class RateLimitBackoffTests(unittest.TestCase):
    def test_retries_429_until_success(self) -> None:
        statuses = iter([429, 429, 200])

        def handler(request: httpx.Request) -> httpx.Response:
            status = next(statuses)
            if status == 429:
                return httpx.Response(status, headers={"Retry-After": "3"})
            return httpx.Response(status, json={"results": []})

        sleeps: list[float] = []
        with httpx.Client(transport=httpx.MockTransport(handler)) as client:
            response = _get_with_backoff(
                client, "https://api.openalex.org/works", {}, sleep=sleeps.append
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(sleeps, [3.0, 3.0])

    def test_uses_exponential_backoff_without_retry_after(self) -> None:
        statuses = iter([429, 503, 200])

        def handler(request: httpx.Request) -> httpx.Response:
            status = next(statuses)
            return httpx.Response(status, json={} if status == 200 else None)

        sleeps: list[float] = []
        with httpx.Client(transport=httpx.MockTransport(handler)) as client:
            response = _get_with_backoff(
                client, "https://api.openalex.org/works", {}, sleep=sleeps.append
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(sleeps, [2.0, 4.0])

    def test_gives_up_after_max_retries_and_returns_last_response(self) -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(429)

        sleeps: list[float] = []
        with httpx.Client(transport=httpx.MockTransport(handler)) as client:
            response = _get_with_backoff(
                client, "https://api.openalex.org/works", {}, sleep=sleeps.append
            )

        self.assertEqual(response.status_code, 429)
        self.assertEqual(len(sleeps), 4)

    def test_non_retryable_status_is_returned_immediately(self) -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(404)

        sleeps: list[float] = []
        with httpx.Client(transport=httpx.MockTransport(handler)) as client:
            response = _get_with_backoff(
                client, "https://api.openalex.org/works", {}, sleep=sleeps.append
            )

        self.assertEqual(response.status_code, 404)
        self.assertEqual(sleeps, [])

    def test_fetch_work_by_doi_reuses_provided_client(self) -> None:
        seen: list[str] = []

        def handler(request: httpx.Request) -> httpx.Response:
            seen.append(str(request.url))
            return httpx.Response(200, json={"doi": "10.1000/x", "cited_by_count": 1})

        with httpx.Client(transport=httpx.MockTransport(handler)) as client:
            work = fetch_work_by_doi("10.1000/x", client=client)

        self.assertIsNotNone(work)
        self.assertEqual(len(seen), 1)


if __name__ == "__main__":
    unittest.main()
