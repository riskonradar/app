from __future__ import annotations

import hashlib
import re
import unicodedata

_DOI_URL_RE = re.compile(r"^https?://(?:dx\.)?doi\.org/", re.IGNORECASE)
_DOI_PREFIX_RE = re.compile(r"^doi:\s*", re.IGNORECASE)
_SPACE_RE = re.compile(r"\s+")
_NON_ALNUM_RE = re.compile(r"[^a-z0-9]+")


def canonicalize_doi(value: str | None) -> str | None:
    if not value:
        return None
    doi = _DOI_URL_RE.sub("", value.strip())
    doi = _DOI_PREFIX_RE.sub("", doi)
    doi = doi.strip().strip(".").lower()
    return doi or None


def title_fingerprint(value: str | None) -> str | None:
    normalized = normalize_text(value)
    if not normalized:
        return None
    fingerprint = _NON_ALNUM_RE.sub("", normalized)
    return fingerprint or None


def abstract_hash(value: str | None) -> str | None:
    normalized = normalize_text(value)
    if not normalized:
        return None
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


def normalize_text(value: str | None) -> str | None:
    if not value:
        return None
    ascii_text = unicodedata.normalize("NFKD", value)
    ascii_text = ascii_text.encode("ascii", "ignore").decode("ascii")
    normalized = _SPACE_RE.sub(" ", ascii_text.lower()).strip()
    return normalized or None


def first_author(authors: list[str]) -> str | None:
    for author in authors:
        normalized = normalize_text(author)
        if normalized:
            return normalized
    return None
