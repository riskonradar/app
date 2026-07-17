from __future__ import annotations

import time
from collections.abc import Iterator
from typing import Any

import httpx

from paper_discovery.models import DiscoveredPaper

_BASE = "https://api.openalex.org/works"
_SELECT = "id,doi,title,abstract_inverted_index,authorships,primary_location,publication_year,open_access,best_oa_location,cited_by_count"
_PAGE_SIZE = 100
_REQUEST_DELAY = 0.125  # OpenAlex polite rate limit (max 10 req/s; stay under it)
_MAX_ATTEMPTS = 5
_BACKOFF_BASE_SECONDS = 2.0
_BACKOFF_CAP_SECONDS = 60.0
_RETRYABLE_STATUSES = frozenset({429, 500, 502, 503, 504})

_last_request_at = 0.0


def _throttle() -> None:
    """Keep every OpenAlex request in this process under the polite rate limit."""
    global _last_request_at
    wait = _REQUEST_DELAY - (time.monotonic() - _last_request_at)
    if wait > 0:
        time.sleep(wait)
    _last_request_at = time.monotonic()


def _get_with_backoff(
    client: httpx.Client,
    url: str,
    params: dict[str, Any],
    sleep=time.sleep,
) -> httpx.Response:
    """GET with retry on rate-limit/transient errors, honoring Retry-After."""
    response: httpx.Response
    for attempt in range(_MAX_ATTEMPTS):
        _throttle()
        response = client.get(url, params=params)
        if response.status_code not in _RETRYABLE_STATUSES:
            return response
        if attempt == _MAX_ATTEMPTS - 1:
            break
        retry_after = response.headers.get("Retry-After")
        try:
            delay = float(retry_after) if retry_after else _BACKOFF_BASE_SECONDS * (2**attempt)
        except ValueError:
            delay = _BACKOFF_BASE_SECONDS * (2**attempt)
        sleep(min(delay, _BACKOFF_CAP_SECONDS))
    return response


def fetch(
    issn: str,
    query: str,
    limit: int,
    contact_email: str | None = None,
    from_publication_date: str | None = None,
) -> Iterator[DiscoveredPaper]:
    """Yield papers from a single OpenAlex ISSN + keyword search, up to limit.

    When from_publication_date (YYYY-MM-DD) is set, only papers published on or
    after that date are returned, newest first — incremental weekly sweeps instead
    of re-fetching the same relevance-ranked top results every run.
    """
    filter_value = f"primary_location.source.issn:{issn},default.search:{query}"
    if from_publication_date:
        filter_value += f",from_publication_date:{from_publication_date}"
    params: dict[str, Any] = {
        "filter": filter_value,
        "select": _SELECT,
        "per-page": min(limit, _PAGE_SIZE),
        "cursor": "*",
    }
    if from_publication_date:
        params["sort"] = "publication_date:desc"
    if contact_email:
        params["mailto"] = contact_email

    fetched = 0
    with httpx.Client(timeout=30) as client:
        while fetched < limit:
            params["per-page"] = min(limit - fetched, _PAGE_SIZE)
            try:
                response = _get_with_backoff(client, _BASE, params)
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

    open_access = item.get("open_access") or {}
    best_oa_location = item.get("best_oa_location") or {}
    cited_by = item.get("cited_by_count")

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
        is_oa=bool(open_access.get("is_oa")) if open_access else None,
        oa_url=best_oa_location.get("pdf_url") or open_access.get("oa_url"),
        oa_status=open_access.get("oa_status"),
        oa_license=best_oa_location.get("license"),
        oa_license_url=license_url_for(best_oa_location.get("license")),
        oa_version=best_oa_location.get("version"),
        cited_by_count=int(cited_by) if cited_by is not None else None,
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


def fetch_work_by_doi(
    doi: str,
    contact_email: str | None = None,
    client: httpx.Client | None = None,
) -> dict[str, Any] | None:
    """Fetch a single OpenAlex work by DOI (open-access + citation fields only).

    Returns None when OpenAlex has no record for the DOI. Pass a shared client
    when calling in a loop so connections are reused across requests.
    """
    url = f"{_BASE}/https://doi.org/{doi}"
    params: dict[str, Any] = {
        "select": "id,doi,open_access,best_oa_location,cited_by_count"
    }
    if contact_email:
        params["mailto"] = contact_email
    if client is None:
        with httpx.Client(timeout=30) as own_client:
            return _fetch_work(own_client, url, params)
    return _fetch_work(client, url, params)


def _fetch_work(
    client: httpx.Client, url: str, params: dict[str, Any]
) -> dict[str, Any] | None:
    response = _get_with_backoff(client, url, params)
    if response.status_code == 404:
        return None
    try:
        response.raise_for_status()
    except httpx.HTTPError as exc:
        raise DiscoverySourceError(f"OpenAlex request failed: {exc}") from exc
    return response.json()


class DiscoverySourceError(RuntimeError):
    pass


def license_url_for(license_id: str | None) -> str | None:
    if not license_id:
        return None
    normalized = license_id.strip().lower().replace("_", "-")
    return {
        "cc-by": "https://creativecommons.org/licenses/by/4.0/",
        "cc-by-4.0": "https://creativecommons.org/licenses/by/4.0/",
        "cc-by-sa": "https://creativecommons.org/licenses/by-sa/4.0/",
        "cc-by-sa-4.0": "https://creativecommons.org/licenses/by-sa/4.0/",
        "cc0": "https://creativecommons.org/publicdomain/zero/1.0/",
        "cc-0": "https://creativecommons.org/publicdomain/zero/1.0/",
        "public-domain": "https://creativecommons.org/publicdomain/mark/1.0/",
    }.get(normalized)
