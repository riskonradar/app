from __future__ import annotations

import re
import time
from collections.abc import Iterator
from typing import Any

import httpx

from paper_discovery.models import DiscoveredPaper

_BASE = "https://api.crossref.org/works"
_SELECT = "DOI,title,abstract,author,container-title,published,URL"
_PAGE_SIZE = 100
_REQUEST_DELAY = 0.15  # seconds — stays within Crossref polite pool


def fetch(
    issn: str,
    query: str,
    limit: int,
    contact_email: str | None = None,
) -> Iterator[DiscoveredPaper]:
    """Yield papers from a single Crossref ISSN + keyword search, up to limit."""
    params: dict[str, Any] = {
        "filter": f"issn:{issn}",
        "query": query,
        "select": _SELECT,
        "rows": min(limit, _PAGE_SIZE),
        "cursor": "*",
    }
    if contact_email:
        params["mailto"] = contact_email

    fetched = 0
    with httpx.Client(timeout=30) as client:
        while fetched < limit:
            params["rows"] = min(limit - fetched, _PAGE_SIZE)
            try:
                response = client.get(_BASE, params=params)
                response.raise_for_status()
            except httpx.HTTPError as exc:
                raise DiscoverySourceError(f"Crossref request failed: {exc}") from exc

            data = response.json()
            message = data.get("message", {})
            items: list[dict[str, Any]] = message.get("items", [])
            if not items:
                break

            for item in items:
                paper = _paper_from_item(item)
                if paper is not None:
                    yield paper
                    fetched += 1
                    if fetched >= limit:
                        break

            next_cursor = message.get("next-cursor")
            if not next_cursor or len(items) < _PAGE_SIZE:
                break
            params["cursor"] = next_cursor
            time.sleep(_REQUEST_DELAY)


def _paper_from_item(item: dict[str, Any]) -> DiscoveredPaper | None:
    doi = item.get("DOI")
    titles = item.get("title", [])
    if not doi or not titles:
        return None

    title = titles[0].strip()
    if not title:
        return None

    raw_abstract = item.get("abstract")
    abstract = _strip_jats(raw_abstract) if raw_abstract else None

    authors = [
        _format_author(a) for a in item.get("author", []) if isinstance(a, dict)
    ]

    container_titles = item.get("container-title", [])
    journal = container_titles[0] if container_titles else None

    published = item.get("published", {})
    date_parts = published.get("date-parts", [[]])
    year = date_parts[0][0] if date_parts and date_parts[0] else None

    return DiscoveredPaper(
        doi=doi,
        title=title,
        abstract=abstract,
        authors=[a for a in authors if a],
        journal=journal,
        year=int(year) if year else None,
        source_url=item.get("URL"),
        raw_payload=item,
    )


def _format_author(author: dict[str, Any]) -> str | None:
    given = author.get("given", "").strip()
    family = author.get("family", "").strip()
    if family and given:
        return f"{given} {family}"
    return family or given or None


def _strip_jats(text: str) -> str:
    return re.sub(r"<[^>]+>", " ", text).strip()


class DiscoverySourceError(RuntimeError):
    pass
