from __future__ import annotations

import hashlib
import json
import subprocess
import sys
import types
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

from paper_classifier.full_text import (
    MAX_PDF_WORKER_OUTPUT_BYTES,
    MAX_PDF_BYTES,
    PDF_WORKER_CPU_SECONDS,
    PDF_WORKER_MEMORY_BYTES,
    PDF_WORKER_TIMEOUT_SECONDS,
    FullTextCandidate,
    FullTextIngestionError,
    _PinnedHTTPResponse,
    _PinnedHTTPSConnection,
    _ResolvedHttpsTarget,
    _apply_pdf_worker_limits,
    _extract_pdf_text,
    _safe_urlopen,
    fetch_open_access_full_text,
)
from paper_classifier.repository import input_hash_for


MIGRATION = (
    Path(__file__).parents[3]
    / "supabase"
    / "migrations"
    / "20260717171000_open_access_full_text_ingestion.sql"
)
FULL_TEXT_SERVICE = (
    Path(__file__).parents[2]
    / "deploy"
    / "systemd"
    / "riskonradar-full-text.service"
)


class _Response:
    def __init__(
        self,
        payload: bytes,
        *,
        content_type: str = "application/pdf",
        content_length: str | None = None,
        url: str = "https://cdn.example.org/paper.pdf",
    ) -> None:
        self.payload = payload
        self.status = 200
        self.headers = {"Content-Type": content_type}
        if content_length is not None:
            self.headers["Content-Length"] = content_length
        self.url = url

    def __enter__(self) -> "_Response":
        return self

    def __exit__(self, *args: object) -> None:
        pass

    def geturl(self) -> str:
        return self.url

    def getcode(self) -> int:
        return self.status

    def read(self, limit: int) -> bytes:
        return self.payload[:limit]


class _RedirectResponse:
    def __init__(
        self,
        status: int,
        url: str,
        headers: dict[str, str] | None = None,
    ) -> None:
        self.status = status
        self.reason = "redirect" if status < 400 else "error"
        self.headers = headers or {}
        self.url = url
        self.closed = False
        self.deadline: float | None = None

    def close(self) -> None:
        self.closed = True

    def geturl(self) -> str:
        return self.url

    def set_deadline(self, deadline: float) -> None:
        self.deadline = deadline


def _candidate(license_id: str | None = "cc-by") -> FullTextCandidate:
    return FullTextCandidate(
        paper_candidate_id="paper-1",
        source_url="https://example.org/paper.pdf",
        oa_status="gold",
        license=license_id,
        license_url="https://creativecommons.org/licenses/by/4.0/",
    )


class FullTextTests(unittest.TestCase):
    def test_https_connection_uses_pinned_ip_but_original_hostname_for_tls(self) -> None:
        raw_socket = MagicMock()
        tls_socket = MagicMock()
        context = MagicMock()
        context.wrap_socket.return_value = tls_socket

        with patch(
            "paper_classifier.full_text._connect_pinned_socket",
            return_value=raw_socket,
        ) as connect_socket:
            connection = _PinnedHTTPSConnection(
                "papers.example.org",
                "93.184.216.34",
                443,
                17,
                context=context,
            )
            connection.connect()

        connect_socket.assert_called_once_with("93.184.216.34", 443, 17)
        context.wrap_socket.assert_called_once_with(
            raw_socket,
            server_hostname="papers.example.org",
        )
        self.assertIs(connection.sock, tls_socket)

    def test_redirect_is_revalidated_and_uses_a_new_pinned_target(self) -> None:
        initial = _ResolvedHttpsTarget(
            url="https://papers.example.org/paper.pdf",
            hostname="papers.example.org",
            port=443,
            addresses=("93.184.216.34",),
            request_target="/paper.pdf",
            host_header="papers.example.org",
        )
        redirected = _ResolvedHttpsTarget(
            url="https://cdn.example.org/final.pdf",
            hostname="cdn.example.org",
            port=443,
            addresses=("203.0.113.10",),
            request_target="/final.pdf",
            host_header="cdn.example.org",
        )
        first_response = _RedirectResponse(
            302,
            initial.url,
            {"Location": redirected.url},
        )
        final_response = _RedirectResponse(200, redirected.url)

        with (
            patch(
                "paper_classifier.full_text._resolve_public_https_target",
                return_value=redirected,
            ) as resolve,
            patch(
                "paper_classifier.full_text._request_pinned_target",
                side_effect=(first_response, final_response),
            ) as request_target,
        ):
            response = _safe_urlopen(
                MagicMock(
                    full_url=initial.url,
                    header_items=lambda: [],
                ),
                timeout=30,
                resolved_target=initial,
            )

        resolve.assert_called_once_with(redirected.url)
        self.assertEqual(
            [call.args[0] for call in request_target.call_args_list],
            [initial, redirected],
        )
        self.assertTrue(first_response.closed)
        self.assertIs(response, final_response)

    @patch("paper_classifier.full_text.socket.getaddrinfo")
    def test_redirect_to_private_address_is_rejected(
        self,
        getaddrinfo: object,
    ) -> None:
        initial = _ResolvedHttpsTarget(
            url="https://papers.example.org/paper.pdf",
            hostname="papers.example.org",
            port=443,
            addresses=("93.184.216.34",),
            request_target="/paper.pdf",
            host_header="papers.example.org",
        )
        redirect = _RedirectResponse(
            302,
            initial.url,
            {"Location": "https://internal.example.org/paper.pdf"},
        )
        getaddrinfo.return_value = [(2, 1, 6, "", ("10.0.0.5", 443))]  # type: ignore[attr-defined]

        with (
            patch(
                "paper_classifier.full_text._request_pinned_target",
                return_value=redirect,
            ),
            self.assertRaisesRegex(FullTextIngestionError, "url_not_public"),
        ):
            _safe_urlopen(
                MagicMock(
                    full_url=initial.url,
                    header_items=lambda: [],
                ),
                timeout=30,
                resolved_target=initial,
            )

        self.assertTrue(redirect.closed)

    def test_drip_response_body_cannot_outlive_redirect_chain_deadline(self) -> None:
        target = _ResolvedHttpsTarget(
            url="https://papers.example.org/paper.pdf",
            hostname="papers.example.org",
            port=443,
            addresses=("93.184.216.34",),
            request_target="/paper.pdf",
            host_header="papers.example.org",
        )
        raw_response = MagicMock()
        raw_response.status = 200
        raw_response.reason = "OK"
        raw_response.headers = {"Content-Type": "application/pdf"}
        raw_response.read1.return_value = b"%PDF-drip"
        connection = MagicMock()
        connection.sock = MagicMock()
        response = _PinnedHTTPResponse(raw_response, connection, target.url)

        with (
            patch(
                "paper_classifier.full_text._resolve_public_https_target",
                return_value=target,
            ),
            patch(
                "paper_classifier.full_text._request_pinned_target",
                return_value=response,
            ),
            patch(
                "paper_classifier.full_text.time.monotonic",
                side_effect=(0.0, 0.0, 29.0, 30.1),
            ),
        ):
            result = fetch_open_access_full_text(_candidate())

        self.assertEqual(result.status, "failed")
        self.assertEqual(result.reason, "download_failed:TimeoutError")
        raw_response.read1.assert_called_once()
        connection.sock.settimeout.assert_called_once_with(1.0)
        connection.close.assert_called_once()

    def test_pdf_extraction_runs_in_bounded_sanitized_worker(self) -> None:
        observed: dict[str, object] = {}

        def run_worker(command: tuple[str, ...], **kwargs: object) -> subprocess.CompletedProcess[bytes]:
            observed["command"] = command
            observed.update(kwargs)
            Path(command[-1]).write_text(
                json.dumps(
                    {
                        "ok": True,
                        "text": "A" * 150,
                        "metadata": {"page_count": 1, "text_truncated": False},
                    }
                ),
                encoding="utf-8",
            )
            return subprocess.CompletedProcess(command, 0)

        with patch("paper_classifier.full_text.subprocess.run", side_effect=run_worker):
            text, metadata = _extract_pdf_text(b"%PDF-1.7\nworker-test")

        command = observed["command"]
        self.assertIn("-I", command)
        self.assertIn("-B", command)
        self.assertEqual(observed["timeout"], PDF_WORKER_TIMEOUT_SECONDS)
        self.assertTrue(callable(observed["preexec_fn"]))
        environment = observed["env"]
        self.assertNotIn("DATABASE_URL", environment)
        self.assertNotIn("SUPABASE_DB_URL", environment)
        self.assertEqual(text, "A" * 150)
        self.assertEqual(metadata["page_count"], 1)

    def test_pdf_worker_timeout_and_oversized_output_fail_closed(self) -> None:
        with (
            patch(
                "paper_classifier.full_text.subprocess.run",
                side_effect=subprocess.TimeoutExpired(("worker",), 20),
            ),
            self.assertRaisesRegex(
                FullTextIngestionError,
                "pdf_extraction_timeout",
            ),
        ):
            _extract_pdf_text(b"%PDF-1.7\ntimeout-test")

        def oversized_worker(
            command: tuple[str, ...],
            **kwargs: object,
        ) -> subprocess.CompletedProcess[bytes]:
            Path(command[-1]).write_bytes(b"x" * (MAX_PDF_WORKER_OUTPUT_BYTES + 1))
            return subprocess.CompletedProcess(command, 0)

        with (
            patch(
                "paper_classifier.full_text.subprocess.run",
                side_effect=oversized_worker,
            ),
            self.assertRaisesRegex(
                FullTextIngestionError,
                "pdf_worker_output_too_large",
            ),
        ):
            _extract_pdf_text(b"%PDF-1.7\noversized-output-test")

    def test_pdf_worker_applies_cpu_memory_file_process_and_fd_limits(self) -> None:
        set_limit = MagicMock()
        resource = types.SimpleNamespace(
            RLIMIT_CORE=1,
            RLIMIT_CPU=2,
            RLIMIT_FSIZE=3,
            RLIMIT_NOFILE=4,
            RLIMIT_AS=5,
            RLIMIT_NPROC=6,
            setrlimit=set_limit,
        )

        with (
            patch.dict(sys.modules, {"resource": resource}),
            patch("paper_classifier.full_text.sys.platform", "linux"),
        ):
            _apply_pdf_worker_limits()

        self.assertEqual(
            set_limit.call_args_list,
            [
                unittest.mock.call(1, (0, 0)),
                unittest.mock.call(
                    2,
                    (PDF_WORKER_CPU_SECONDS, PDF_WORKER_CPU_SECONDS),
                ),
                unittest.mock.call(
                    3,
                    (
                        MAX_PDF_WORKER_OUTPUT_BYTES,
                        MAX_PDF_WORKER_OUTPUT_BYTES,
                    ),
                ),
                unittest.mock.call(4, (32, 32)),
                unittest.mock.call(
                    5,
                    (PDF_WORKER_MEMORY_BYTES, PDF_WORKER_MEMORY_BYTES),
                ),
                unittest.mock.call(6, (1, 1)),
            ],
        )

    def test_full_text_fingerprint_changes_classifier_input_hash(self) -> None:
        abstract_only = input_hash_for("Title", "Abstract")
        with_full_text = input_hash_for("Title", "Abstract", "a" * 64)

        self.assertNotEqual(abstract_only, with_full_text)

    def test_missing_or_noncommercial_license_is_rejected_before_download(self) -> None:
        opener_called = False

        def opener(*args: object, **kwargs: object) -> _Response:
            nonlocal opener_called
            opener_called = True
            raise AssertionError("download must not run")

        self.assertEqual(
            fetch_open_access_full_text(_candidate(None), opener=opener).reason,
            "license_missing",
        )
        self.assertEqual(
            fetch_open_access_full_text(_candidate("cc-by-nc"), opener=opener).reason,
            "license_not_allowlisted",
        )
        self.assertEqual(
            fetch_open_access_full_text(_candidate("cc-by-sa"), opener=opener).reason,
            "license_not_allowlisted",
        )
        self.assertFalse(opener_called)

    @patch("paper_classifier.full_text.socket.getaddrinfo")
    def test_content_type_and_declared_size_are_guarded(self, getaddrinfo: object) -> None:
        getaddrinfo.return_value = [(2, 1, 6, "", ("93.184.216.34", 443))]  # type: ignore[attr-defined]

        html = fetch_open_access_full_text(
            _candidate(), opener=lambda *a, **k: _Response(b"<html>", content_type="text/html")
        )
        oversized = fetch_open_access_full_text(
            _candidate(),
            opener=lambda *a, **k: _Response(
                b"%PDF-1.7", content_length=str(MAX_PDF_BYTES + 1)
            ),
        )

        self.assertEqual(html.status, "rejected")
        self.assertEqual(html.reason, "content_type_not_pdf")
        self.assertEqual(oversized.reason, "content_too_large")

    @patch("paper_classifier.full_text.socket.getaddrinfo")
    def test_private_network_target_is_rejected(self, getaddrinfo: object) -> None:
        getaddrinfo.return_value = [(2, 1, 6, "", ("127.0.0.1", 443))]  # type: ignore[attr-defined]

        result = fetch_open_access_full_text(_candidate())

        self.assertEqual(result.status, "rejected")
        self.assertEqual(result.reason, "url_not_public")

    @patch("paper_classifier.full_text.socket.getaddrinfo")
    def test_valid_pdf_records_hash_text_and_extraction_limits(self, getaddrinfo: object) -> None:
        getaddrinfo.return_value = [(2, 1, 6, "", ("93.184.216.34", 443))]  # type: ignore[attr-defined]
        payload = b"%PDF-1.7\nsmall-test-pdf"

        result = fetch_open_access_full_text(
            _candidate("cc-by-4.0"),
            opener=lambda *a, **k: _Response(payload),
            pdf_extractor=lambda value: ("A" * 150, {"page_count": 1, "text_truncated": False}),
        )

        self.assertEqual(result.status, "fetched")
        self.assertEqual(result.content_sha256, hashlib.sha256(payload).hexdigest())
        self.assertEqual(result.content_bytes, len(payload))
        self.assertEqual(len(result.extracted_text or ""), 150)

    def test_migration_keeps_full_text_private_and_links_evidence_provenance(self) -> None:
        sql = MIGRATION.read_text(encoding="utf-8")

        self.assertIn("CREATE TABLE papers_raw.paper_full_texts", sql)
        self.assertIn("REVOKE ALL ON TABLE papers_raw.paper_full_texts FROM PUBLIC, anon, authenticated", sql)
        self.assertIn("ADD COLUMN full_text_id uuid", sql)
        self.assertIn("evidence_spans_full_text_provenance_check", sql)
        self.assertIn("content_bytes <= 20971520", sql)
        self.assertIn("retrieval_status != 'fetched' OR content_bytes <= 20971520", sql)
        self.assertNotIn("bytea", sql.lower())

    def test_full_text_systemd_unit_has_resource_and_filesystem_sandbox(self) -> None:
        unit = FULL_TEXT_SERVICE.read_text(encoding="utf-8")

        for directive in (
            "DynamicUser=true",
            "ProtectSystem=strict",
            "PrivateDevices=true",
            "TemporaryFileSystem=/tmp:rw,nosuid,nodev,noexec,size=128M",
            "MemoryMax=1G",
            "CPUQuota=200%",
            "RuntimeMaxSec=4h",
            "TasksMax=32",
            "RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6",
            "CapabilityBoundingSet=",
        ):
            self.assertIn(directive, unit)


if __name__ == "__main__":
    unittest.main()
