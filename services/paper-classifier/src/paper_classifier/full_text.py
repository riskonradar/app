from __future__ import annotations

import hashlib
import http.client
import ipaddress
import json
import os
import socket
import ssl
import stat
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from io import BytesIO
from pathlib import Path
from typing import Any, Callable


MAX_PDF_BYTES = 20 * 1024 * 1024
MAX_PDF_PAGES = 200
MAX_EXTRACTED_CHARACTERS = 300_000
MAX_REDIRECTS = 5
MAX_RESOLVED_ADDRESSES = 8
RESPONSE_READ_CHUNK_BYTES = 64 * 1024
PDF_WORKER_TIMEOUT_SECONDS = 20
PDF_WORKER_CPU_SECONDS = 10
PDF_WORKER_MEMORY_BYTES = 768 * 1024 * 1024
MAX_PDF_WORKER_OUTPUT_BYTES = MAX_EXTRACTED_CHARACTERS * 4 + 64 * 1024
ALLOWED_LICENSES = frozenset({"cc-by", "cc0", "public-domain"})


@dataclass(frozen=True)
class FullTextCandidate:
    paper_candidate_id: str
    source_url: str
    oa_status: str | None
    license: str | None
    license_url: str | None = None


@dataclass(frozen=True)
class FullTextFetchResult:
    status: str
    resolved_url: str | None = None
    http_status: int | None = None
    content_type: str | None = None
    content_bytes: int | None = None
    content_sha256: str | None = None
    extracted_text: str | None = None
    extraction_method: str | None = None
    reason: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)


class FullTextIngestionError(RuntimeError):
    pass


@dataclass(frozen=True)
class _ResolvedHttpsTarget:
    url: str
    hostname: str
    port: int
    addresses: tuple[str, ...]
    request_target: str
    host_header: str


def fetch_open_access_full_text(
    candidate: FullTextCandidate,
    *,
    opener: Callable[..., Any] | None = None,
    pdf_extractor: Callable[[bytes], tuple[str, dict[str, Any]]] | None = None,
) -> FullTextFetchResult:
    """Fetch and extract one explicitly licensed OA PDF.

    Rejections are expected policy outcomes; failures are transient or malformed
    responses that may be retried by a later backfill.
    """
    license_id = _normalize_license(candidate.license)
    if license_id not in ALLOWED_LICENSES:
        return FullTextFetchResult(
            status="rejected",
            reason="license_not_allowlisted" if license_id else "license_missing",
            metadata={"reported_license": candidate.license},
        )

    try:
        initial_target = _resolve_public_https_target(candidate.source_url)
    except FullTextIngestionError as exc:
        return FullTextFetchResult(status="rejected", reason=str(exc))

    request = urllib.request.Request(
        candidate.source_url,
        headers={
            "Accept": "application/pdf",
            "User-Agent": _user_agent(),
        },
        method="GET",
    )
    try:
        response_context = (
            opener(request, timeout=30)
            if opener is not None
            else _safe_urlopen(
                request,
                timeout=30,
                resolved_target=initial_target,
            )
        )
        with response_context as response:
            resolved_url = response.geturl()
            if opener is not None:
                _validate_public_https_url(resolved_url)
            status = int(getattr(response, "status", response.getcode()))
            content_type = _media_type(response.headers.get("Content-Type"))
            if content_type != "application/pdf":
                return FullTextFetchResult(
                    status="rejected",
                    resolved_url=resolved_url,
                    http_status=status,
                    content_type=content_type,
                    reason="content_type_not_pdf",
                )

            declared_length = _content_length(response.headers.get("Content-Length"))
            if declared_length is not None and declared_length > MAX_PDF_BYTES:
                return FullTextFetchResult(
                    status="rejected",
                    resolved_url=resolved_url,
                    http_status=status,
                    content_type=content_type,
                    content_bytes=declared_length,
                    reason="content_too_large",
                )

            payload = response.read(MAX_PDF_BYTES + 1)
    except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, OSError) as exc:
        return FullTextFetchResult(status="failed", reason=f"download_failed:{type(exc).__name__}")
    except FullTextIngestionError as exc:
        return FullTextFetchResult(status="rejected", reason=str(exc))

    if len(payload) > MAX_PDF_BYTES:
        return FullTextFetchResult(
            status="rejected",
            resolved_url=resolved_url,
            http_status=status,
            content_type=content_type,
            content_bytes=len(payload),
            reason="content_too_large",
        )
    if not payload.startswith(b"%PDF-"):
        return FullTextFetchResult(
            status="rejected",
            resolved_url=resolved_url,
            http_status=status,
            content_type=content_type,
            content_bytes=len(payload),
            reason="invalid_pdf_signature",
        )

    try:
        text, extraction_metadata = (pdf_extractor or _extract_pdf_text)(payload)
    except FullTextIngestionError as exc:
        return FullTextFetchResult(
            status="failed",
            resolved_url=resolved_url,
            http_status=status,
            content_type=content_type,
            content_bytes=len(payload),
            content_sha256=hashlib.sha256(payload).hexdigest(),
            reason=str(exc),
        )

    return FullTextFetchResult(
        status="fetched",
        resolved_url=resolved_url,
        http_status=status,
        content_type=content_type,
        content_bytes=len(payload),
        content_sha256=hashlib.sha256(payload).hexdigest(),
        extracted_text=text,
        extraction_method="pypdf",
        metadata=extraction_metadata,
    )


def _extract_pdf_text(payload: bytes) -> tuple[str, dict[str, Any]]:
    if len(payload) > MAX_PDF_BYTES:
        raise FullTextIngestionError("content_too_large")

    with tempfile.TemporaryDirectory(prefix="riskonradar-pdf-") as directory:
        workdir = Path(directory)
        input_path = workdir / "input.pdf"
        output_path = workdir / "result.json"
        input_path.write_bytes(payload)
        input_path.chmod(0o400)

        command = (
            sys.executable,
            "-I",
            "-B",
            "-m",
            "paper_classifier.pdf_worker",
            str(input_path),
            str(output_path),
        )
        environment = {
            "PATH": os.defpath,
            "LANG": "C.UTF-8",
            "LC_ALL": "C.UTF-8",
            "PYTHONDONTWRITEBYTECODE": "1",
            "PYTHONIOENCODING": "utf-8",
        }
        try:
            completed = subprocess.run(
                command,
                stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                env=environment,
                timeout=PDF_WORKER_TIMEOUT_SECONDS,
                check=False,
                preexec_fn=_apply_pdf_worker_limits if os.name == "posix" else None,
            )
        except subprocess.TimeoutExpired as exc:
            raise FullTextIngestionError("pdf_extraction_timeout") from exc
        except (OSError, subprocess.SubprocessError) as exc:
            raise FullTextIngestionError(
                f"pdf_worker_start_failed:{type(exc).__name__}"
            ) from exc

        if completed.returncode != 0:
            raise FullTextIngestionError("pdf_worker_failed")
        try:
            output_stat = output_path.lstat()
        except FileNotFoundError as exc:
            raise FullTextIngestionError("pdf_worker_no_output") from exc
        if not stat.S_ISREG(output_stat.st_mode):
            raise FullTextIngestionError("pdf_worker_invalid_output")
        if output_stat.st_size > MAX_PDF_WORKER_OUTPUT_BYTES:
            raise FullTextIngestionError("pdf_worker_output_too_large")
        output = output_path.read_bytes()

    if len(output) > MAX_PDF_WORKER_OUTPUT_BYTES:
        raise FullTextIngestionError("pdf_worker_output_too_large")
    try:
        result = json.loads(output)
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise FullTextIngestionError("pdf_worker_invalid_output") from exc
    if not isinstance(result, dict):
        raise FullTextIngestionError("pdf_worker_invalid_output")
    if result.get("ok") is not True:
        error = result.get("error")
        if not isinstance(error, str) or not error or len(error) > 200:
            raise FullTextIngestionError("pdf_worker_failed")
        raise FullTextIngestionError(error)

    text = result.get("text")
    metadata = result.get("metadata")
    if (
        not isinstance(text, str)
        or not 100 <= len(text) <= MAX_EXTRACTED_CHARACTERS
        or not isinstance(metadata, dict)
    ):
        raise FullTextIngestionError("pdf_worker_invalid_output")
    return text, metadata


def _apply_pdf_worker_limits() -> None:
    import resource

    limits = (
        (resource.RLIMIT_CORE, 0),
        (resource.RLIMIT_CPU, PDF_WORKER_CPU_SECONDS),
        (resource.RLIMIT_FSIZE, MAX_PDF_WORKER_OUTPUT_BYTES),
        (resource.RLIMIT_NOFILE, 32),
    )
    if sys.platform.startswith("linux") and hasattr(resource, "RLIMIT_AS"):
        limits = (*limits, (resource.RLIMIT_AS, PDF_WORKER_MEMORY_BYTES))
    for resource_id, value in limits:
        resource.setrlimit(resource_id, (value, value))
    if hasattr(resource, "RLIMIT_NPROC"):
        resource.setrlimit(resource.RLIMIT_NPROC, (1, 1))


def _extract_pdf_text_in_process(payload: bytes) -> tuple[str, dict[str, Any]]:
    try:
        from pypdf import PdfReader
    except ImportError as exc:
        raise FullTextIngestionError("pypdf_not_installed") from exc

    try:
        reader = PdfReader(BytesIO(payload), strict=False)
        if reader.is_encrypted:
            raise FullTextIngestionError("encrypted_pdf")
        page_count = len(reader.pages)
        if page_count > MAX_PDF_PAGES:
            raise FullTextIngestionError("page_limit_exceeded")

        parts: list[str] = []
        total = 0
        truncated = False
        for page in reader.pages:
            page_text = (page.extract_text() or "").replace("\x00", "").strip()
            if not page_text:
                continue
            separator = "\n\n" if parts else ""
            remaining = MAX_EXTRACTED_CHARACTERS - total - len(separator)
            if remaining <= 0:
                truncated = True
                break
            if len(page_text) > remaining:
                page_text = page_text[:remaining]
                truncated = True
            parts.append(f"{separator}{page_text}")
            total += len(separator) + len(page_text)
            if truncated:
                break
    except FullTextIngestionError:
        raise
    except Exception as exc:
        raise FullTextIngestionError(f"pdf_extraction_failed:{type(exc).__name__}") from exc

    text = "".join(parts).strip()
    if len(text) < 100:
        raise FullTextIngestionError("no_extractable_text")
    return text, {"page_count": page_count, "text_truncated": truncated}


def _normalize_license(value: str | None) -> str | None:
    if not value:
        return None
    normalized = value.strip().lower().replace("_", "-")
    aliases = {
        "cc-by-4.0": "cc-by",
        "cc-by-3.0": "cc-by",
        "cc-0": "cc0",
        "public domain": "public-domain",
    }
    return aliases.get(normalized, normalized)


def _validate_public_https_url(value: str) -> None:
    _resolve_public_https_target(value)


def _resolve_public_https_target(value: str) -> _ResolvedHttpsTarget:
    parsed = urllib.parse.urlsplit(value)
    if parsed.scheme.lower() != "https":
        raise FullTextIngestionError("url_not_https")
    if not parsed.hostname or parsed.username or parsed.password:
        raise FullTextIngestionError("url_invalid_authority")
    try:
        port = parsed.port or 443
    except ValueError as exc:
        raise FullTextIngestionError("url_invalid_authority") from exc
    if port != 443:
        raise FullTextIngestionError("url_port_not_allowed")
    if any(ord(character) < 32 for character in value):
        raise FullTextIngestionError("url_invalid_authority")
    try:
        hostname = parsed.hostname.encode("idna").decode("ascii")
    except UnicodeError as exc:
        raise FullTextIngestionError("url_invalid_authority") from exc
    try:
        resolved = socket.getaddrinfo(
            hostname,
            port,
            type=socket.SOCK_STREAM,
            proto=socket.IPPROTO_TCP,
        )
    except socket.gaierror as exc:
        raise FullTextIngestionError("url_dns_failed") from exc

    addresses: dict[bytes, ipaddress.IPv4Address | ipaddress.IPv6Address] = {}
    for item in resolved:
        raw_address = str(item[4][0]).split("%", 1)[0]
        try:
            address = ipaddress.ip_address(raw_address)
        except ValueError as exc:
            raise FullTextIngestionError("url_dns_failed") from exc
        addresses[address.packed] = address
    if not addresses or any(not address.is_global for address in addresses.values()):
        raise FullTextIngestionError("url_not_public")

    ordered_addresses = tuple(
        str(address)
        for address in sorted(
            addresses.values(),
            key=lambda address: (address.version, address.packed),
        )[:MAX_RESOLVED_ADDRESSES]
    )
    request_target = urllib.parse.urlunsplit(
        ("", "", parsed.path or "/", parsed.query, "")
    )
    try:
        host_ip = ipaddress.ip_address(hostname)
    except ValueError:
        host_header = hostname
    else:
        host_header = f"[{hostname}]" if host_ip.version == 6 else hostname
    normalized_url = urllib.parse.urlunsplit(
        ("https", parsed.netloc, parsed.path or "/", parsed.query, "")
    )
    return _ResolvedHttpsTarget(
        url=normalized_url,
        hostname=hostname,
        port=port,
        addresses=ordered_addresses,
        request_target=request_target,
        host_header=host_header,
    )


class _PinnedHTTPSConnection(http.client.HTTPSConnection):
    def __init__(
        self,
        hostname: str,
        pinned_address: str,
        port: int,
        timeout: int | float,
        *,
        context: ssl.SSLContext | None = None,
    ) -> None:
        super().__init__(
            hostname,
            port=port,
            timeout=timeout,
            context=context or ssl.create_default_context(),
        )
        self._pinned_address = pinned_address

    def connect(self) -> None:
        raw_socket = _connect_pinned_socket(
            self._pinned_address,
            self.port,
            self.timeout,
        )
        try:
            self.sock = self._context.wrap_socket(
                raw_socket,
                server_hostname=self.host,
            )
        except Exception:
            raw_socket.close()
            raise


class _PinnedHTTPResponse:
    def __init__(
        self,
        response: http.client.HTTPResponse,
        connection: _PinnedHTTPSConnection,
        url: str,
    ) -> None:
        self._response = response
        self._connection = connection
        self._url = url
        self.status = response.status
        self.reason = response.reason
        self.headers = response.headers
        self._deadline: float | None = None
        response_file = getattr(response, "fp", None)
        response_raw = getattr(response_file, "raw", None)
        self._network_socket = connection.sock or getattr(
            response_raw,
            "_sock",
            None,
        )

    def __enter__(self) -> _PinnedHTTPResponse:
        return self

    def __exit__(self, *args: object) -> None:
        self.close()

    def geturl(self) -> str:
        return self._url

    def getcode(self) -> int:
        return self.status

    def set_deadline(self, deadline: float) -> None:
        self._deadline = deadline

    def read(self, limit: int = -1) -> bytes:
        if self._deadline is None:
            return self._response.read(limit)

        parts: list[bytes] = []
        total = 0
        while limit < 0 or total < limit:
            remaining_time = self._deadline - time.monotonic()
            if remaining_time <= 0:
                raise TimeoutError("response body deadline exceeded")
            if self._network_socket is None:
                raise OSError("response socket unavailable")
            self._network_socket.settimeout(remaining_time)
            chunk_size = RESPONSE_READ_CHUNK_BYTES
            if limit >= 0:
                chunk_size = min(chunk_size, limit - total)
            chunk = self._response.read1(chunk_size)
            if not chunk:
                break
            parts.append(chunk)
            total += len(chunk)
        return b"".join(parts)

    def close(self) -> None:
        try:
            self._response.close()
        finally:
            self._connection.close()


def _connect_pinned_socket(
    address: str,
    port: int,
    timeout: int | float | None,
) -> socket.socket:
    parsed_address = ipaddress.ip_address(address)
    family = socket.AF_INET6 if parsed_address.version == 6 else socket.AF_INET
    raw_socket = socket.socket(family, socket.SOCK_STREAM, socket.IPPROTO_TCP)
    try:
        raw_socket.settimeout(timeout)
        destination: tuple[Any, ...] = (
            (address, port, 0, 0)
            if parsed_address.version == 6
            else (address, port)
        )
        raw_socket.connect(destination)
        return raw_socket
    except Exception:
        raw_socket.close()
        raise


def _request_pinned_target(
    target: _ResolvedHttpsTarget,
    headers: dict[str, str],
    timeout: int | float,
) -> _PinnedHTTPResponse:
    last_error: BaseException | None = None
    deadline = time.monotonic() + timeout
    for address in target.addresses:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise TimeoutError("pinned connection deadline exceeded")
        connection = _PinnedHTTPSConnection(
            target.hostname,
            address,
            target.port,
            remaining,
        )
        try:
            connection.request(
                "GET",
                target.request_target,
                headers={**headers, "Host": target.host_header},
            )
            response = connection.getresponse()
            return _PinnedHTTPResponse(response, connection, target.url)
        except (OSError, ssl.SSLError, http.client.HTTPException) as exc:
            last_error = exc
            connection.close()
    if last_error is not None:
        raise urllib.error.URLError(last_error)
    raise FullTextIngestionError("url_dns_failed")


def _safe_urlopen(
    request: urllib.request.Request,
    timeout: int,
    *,
    resolved_target: _ResolvedHttpsTarget | None = None,
) -> _PinnedHTTPResponse:
    target = resolved_target or _resolve_public_https_target(request.full_url)
    headers = {
        name: value
        for name, value in request.header_items()
        if name.lower()
        not in {"authorization", "cookie", "host", "proxy-authorization"}
    }
    headers["Connection"] = "close"
    visited: set[str] = set()
    deadline = time.monotonic() + timeout
    for redirect_count in range(MAX_REDIRECTS + 1):
        if target.url in visited:
            raise FullTextIngestionError("redirect_loop")
        visited.add(target.url)
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise TimeoutError("download deadline exceeded")
        response = _request_pinned_target(target, headers, remaining)
        if response.status in {301, 302, 303, 307, 308}:
            location = response.headers.get("Location")
            response.close()
            if not location:
                raise FullTextIngestionError("redirect_missing_location")
            if redirect_count >= MAX_REDIRECTS:
                raise FullTextIngestionError("too_many_redirects")
            redirected_url = urllib.parse.urljoin(target.url, location)
            target = _resolve_public_https_target(redirected_url)
            continue
        if response.status >= 400:
            status = response.status
            reason = response.reason
            response_headers = response.headers
            response.close()
            raise urllib.error.HTTPError(
                target.url,
                status,
                str(reason),
                response_headers,
                None,
            )
        response.set_deadline(deadline)
        return response
    raise FullTextIngestionError("too_many_redirects")


def _media_type(value: str | None) -> str | None:
    return value.split(";", 1)[0].strip().lower() if value else None


def _content_length(value: str | None) -> int | None:
    if not value:
        return None
    try:
        length = int(value)
    except ValueError:
        return None
    return max(length, 0)


def _user_agent() -> str:
    contact = os.environ.get("DISCOVERY_CONTACT_EMAIL", "").strip()
    suffix = f" (mailto:{contact})" if contact else ""
    return f"RiskOnRadar-full-text/1.0{suffix}"
