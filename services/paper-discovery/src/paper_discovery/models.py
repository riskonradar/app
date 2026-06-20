from __future__ import annotations

from dataclasses import dataclass, field

from paper_discovery.dedupe import abstract_hash, canonicalize_doi, first_author, title_fingerprint


@dataclass(frozen=True)
class DiscoveredPaper:
    doi: str | None
    title: str
    abstract: str | None
    authors: list[str]
    journal: str | None
    year: int | None
    source_url: str | None
    external_ids: dict[str, str] = field(default_factory=dict)
    raw_payload: dict = field(default_factory=dict)

    @property
    def canonical_doi(self) -> str | None:
        return canonicalize_doi(self.doi)

    @property
    def title_fingerprint(self) -> str | None:
        return title_fingerprint(self.title)

    @property
    def abstract_hash(self) -> str | None:
        return abstract_hash(self.abstract)

    @property
    def first_author(self) -> str | None:
        return first_author(self.authors)
