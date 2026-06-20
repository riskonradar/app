from __future__ import annotations

import json
from pathlib import Path

_DATA = Path(__file__).parent.parent.parent / "data" / "queries.json"


def load_queries(path: Path = _DATA) -> tuple[str, ...]:
    data = json.loads(path.read_text(encoding="utf-8"))
    combined: list[str] = []
    for key, values in data.items():
        if key.startswith("_"):
            continue
        combined.extend(values)
    return tuple(combined)


DISCOVERY_QUERIES: tuple[str, ...] = load_queries()
