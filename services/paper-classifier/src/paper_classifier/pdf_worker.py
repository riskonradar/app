from __future__ import annotations

import json
import os
import sys
from pathlib import Path

from paper_classifier.full_text import (
    MAX_PDF_BYTES,
    MAX_PDF_WORKER_OUTPUT_BYTES,
    FullTextIngestionError,
    _extract_pdf_text_in_process,
)


def main() -> int:
    if len(sys.argv) != 3:
        return 2
    input_path = Path(sys.argv[1])
    output_path = Path(sys.argv[2])
    try:
        input_stat = input_path.stat()
        if input_stat.st_size > MAX_PDF_BYTES:
            raise FullTextIngestionError("content_too_large")
        payload = input_path.read_bytes()
        if len(payload) > MAX_PDF_BYTES:
            raise FullTextIngestionError("content_too_large")
        text, metadata = _extract_pdf_text_in_process(payload)
        result = {"ok": True, "text": text, "metadata": metadata}
    except FullTextIngestionError as exc:
        result = {"ok": False, "error": str(exc)[:200]}
    except Exception as exc:
        result = {
            "ok": False,
            "error": f"pdf_extraction_failed:{type(exc).__name__}",
        }

    encoded = json.dumps(
        result,
        ensure_ascii=False,
        separators=(",", ":"),
    ).encode("utf-8")
    if len(encoded) > MAX_PDF_WORKER_OUTPUT_BYTES:
        encoded = b'{"ok":false,"error":"pdf_worker_output_too_large"}'
    descriptor = os.open(
        output_path,
        os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0),
        0o600,
    )
    with os.fdopen(descriptor, "wb") as output:
        output.write(encoded)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
