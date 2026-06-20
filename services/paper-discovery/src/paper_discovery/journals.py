from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

_DATA = Path(__file__).parent.parent.parent / "data" / "journals.json"


@dataclass(frozen=True)
class Journal:
    name: str
    issn: str
    publisher: str = ""
    notes: str = ""


def load_journals(path: Path = _DATA) -> tuple[Journal, ...]:
    rows = json.loads(path.read_text(encoding="utf-8"))
    return tuple(Journal(**row) for row in rows)


TRUSTED_JOURNALS: tuple[Journal, ...] = load_journals()
