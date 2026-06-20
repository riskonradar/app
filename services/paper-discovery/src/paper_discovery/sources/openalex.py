from __future__ import annotations

import time
from collections.abc import Iterator
from typing import Any

import httpx

from paper_discovery.models import DiscoveredPaper

_BASE = "https://api.openalex.org/works"
_SELECT = "id,doi,title,abstract_inverted_index,authorships,primary_location,publication_year"
_PAGE_SIZE = 100
_REQUEST_DELAY = 0.1  # OpenAlex polite rate limit


def fetch(
    issn: str,
    query: str,
    limit: int,
    contact_email: str | None = None,
) -> Iterator[DiscoveredPaper]:
    """Yield papers from a single OpenAlex ISSN + keyword search, up to limit."""
    params: dict[str, Any] = {
        "filter": f"primary_location.source.issn:{issn},default.search:{query}",
        "select": _SELECT,
        "per-page": min(limit, _PAGE_SIZE),
        "cursor": "*",
    }
    if contact_email:
        params["mailto"] = contact_email

    fetched = 0
    with httpx.Client(timeout=30) as client:
        while fetched < limit:
            params["per-page"] = min(limit - fetched, _PAGE_SIZE)
            try:
                response = client.get(_BASE, params=params)
                response.raise_for_status()
            except httpx.HTTPError as exc:
                raise DiscoverySourceError(f"OpenAlex request failed: {exc}") from exc

            data = response.json()
            results: list[dict[str, Any]] = data.get("results", [])
            if not results:
                break

            for item in results:
                paper = _paper_from_item(item)
                if paper is not None:
                    yield paper
                    fetched += 1
                    if fetched >= limit:
                        break

            meta = data.get("meta", {})
            next_cursor = meta.get("next_cursor")
            if not next_cursor or len(results) < _PAGE_SIZE:
                break
            params["cursor"] = next_cursor
            time.sleep(_REQUEST_DELAY)


def _paper_from_item(item: dict[str, Any]) -> DiscoveredPaper | None:
    raw_doi = item.get("doi")
    title = (item.get("title") or "").strip()
    if not raw_doi or not title:
        return None

    doi = raw_doi.removeprefix("https://doi.org/")

    inverted = item.get("abstract_inverted_index")
    abstract = _reconstruct_abstract(inverted) if inverted else None

    authors = [
        _format_authorship(a) for a in item.get("authorships", []) if isinstance(a, dict)
    ]

    location = item.get("primary_location") or {}
    source = location.get("source") or {}
    journal = source.get("display_name")

    year = item.get("publication_year")
    source_url = f"https://doi.org/{doi}"

    return DiscoveredPaper(
        doi=doi,
        title=title,
        abstract=abstract,
        authors=[a for a in authors if a],
        journal=journal,
        year=int(year) if year else None,
        source_url=source_url,
        external_ids={"openalex": item["id"]} if item.get("id") else {},
        raw_payload=item,
    )


def _reconstruct_abstract(inverted_index: dict[str, list[int]]) -> str:
    pos_word: dict[int, str] = {}
    for word, positions in inverted_index.items():
        for pos in positions:
            pos_word[pos] = word
    return " ".join(pos_word[i] for i in sorted(pos_word))


def _format_authorship(authorship: dict[str, Any]) -> str | None:
    author = authorship.get("author") or {}
    name = author.get("display_name", "").strip()
    return name or None


class DiscoverySourceError(RuntimeError):
    pass
