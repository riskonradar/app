from __future__ import annotations

import sqlite3
from collections.abc import Iterator
from pathlib import Path

from paper_classifier.models import Paper


def iter_corpus_papers(corpus_db: Path, limit: int | None = None) -> Iterator[Paper]:
    query = """
        select id, doi, title, abstract, journal, year, authors, url, source, cited_by, openalex_id
        from papers
        where title is not null and trim(title) <> ''
        order by year desc nulls last, title asc
    """
    if limit is not None:
        query += " limit ?"

    with sqlite3.connect(corpus_db) as connection:
        connection.row_factory = sqlite3.Row
        cursor = connection.execute(query, (limit,) if limit is not None else ())
        for row in cursor:
            yield Paper(
                id=row["id"],
                doi=_clean(row["doi"]),
                title=row["title"],
                abstract=_clean(row["abstract"]),
                journal=_clean(row["journal"]),
                year=row["year"],
                authors=_clean(row["authors"]),
                url=_clean(row["url"]),
                source=_clean(row["source"]) or "corpus",
                cited_by=row["cited_by"],
                openalex_id=_clean(row["openalex_id"]),
            )


def _clean(value: object) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None
