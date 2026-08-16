from __future__ import annotations

import io
import re
from typing import Any

from pypdf import PdfReader
from pypdf.errors import PdfReadError

from .config import ParserSettings

OBJECT_PATTERN = re.compile(rb"(?m)^\s*(\d{1,10})\s+(\d{1,10})\s+obj\b")
MAX_ACTION_SCAN_NODES = 50_000
MAX_ACTION_SCAN_DEPTH = 20


class PdfSecurityError(ValueError):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def _count_objects(content: bytes) -> int:
    count = 0
    for _match in OBJECT_PATTERN.finditer(content):
        count += 1
        if count > 100_000:
            break
    return count


def _bounded_action_scan(
    value: Any, visited: set[int], budget: list[int], depth: int = 0
) -> str | None:
    """Return the action name ('javascript', 'launch', 'uri') if an unsafe action is found."""
    if depth > MAX_ACTION_SCAN_DEPTH:
        return None
    if budget[0] <= 0:
        return None
    budget[0] -= 1
    if isinstance(value, dict):
        if budget[0] <= 0:
            return None
        marker = id(value)
        if marker in visited:
            return None
        visited.add(marker)
        action_type = value.get("/S")
        if action_type == "/JavaScript":
            return "javascript"
        if action_type == "/Launch":
            return "launch"
        if action_type == "/URI":
            return "uri"
        for key, child in value.items():
            if key in {"/A", "/AA", "/OpenAction", "/Names", "/JavaScript"} or isinstance(
                child, (dict, list)
            ):
                found = _bounded_action_scan(child, visited, budget, depth + 1)
                if found:
                    return found
        return None
    if isinstance(value, list):
        for child in value:
            if budget[0] <= 0:
                return None
            found = _bounded_action_scan(child, visited, budget, depth + 1)
            if found:
                return found
        return None
    return None


def _unsafe_action_code(reader: PdfReader) -> str | None:
    budget = [MAX_ACTION_SCAN_NODES]
    visited: set[int] = set()
    root = reader.trailer.get("/Root")
    if root is not None:
        found = _bounded_action_scan(root, visited, budget)
        if found:
            return f"PDF_UNSAFE_ACTION_{found.upper()}"
    for page in reader.pages:
        if budget[0] <= 0:
            return "PDF_CONTENT_LIMIT"
        found = _bounded_action_scan(dict(page), visited, budget)
        if found:
            return f"PDF_UNSAFE_ACTION_{found.upper()}"
    return None


def validate_pdf_container(content: bytes, settings: ParserSettings) -> None:
    if len(content) == 0 or len(content) > settings.max_pdf_upload_bytes:
        raise PdfSecurityError("PDF_TOO_LARGE")
    if not content.startswith(b"%PDF-"):
        raise PdfSecurityError("PDF_INVALID")
    tail = content[-4_096:]
    if b"startxref" not in tail or b"%%EOF" not in tail:
        raise PdfSecurityError("PDF_MALFORMED")
    if _count_objects(content) > settings.max_pdf_objects:
        raise PdfSecurityError("PDF_CONTENT_LIMIT")

    try:
        reader = PdfReader(io.BytesIO(content))
    except (PdfReadError, ValueError, RecursionError) as error:
        raise PdfSecurityError("PDF_MALFORMED") from error
    try:
        if reader.is_encrypted:
            try:
                if not reader.decrypt(""):
                    raise PdfSecurityError("PDF_PASSWORD_REQUIRED")
            except (NotImplementedError, PdfReadError) as error:
                raise PdfSecurityError("PDF_ENCRYPTED") from error
        if len(reader.pages) > settings.max_pdf_pages:
            raise PdfSecurityError("PDF_TOO_MANY_PAGES")
        if reader.attachments:
            raise PdfSecurityError("PDF_EMBEDDED_FILE_UNSUPPORTED")
        unsafe = _unsafe_action_code(reader)
        if unsafe:
            raise PdfSecurityError(unsafe)
        total_stream_bytes = 0
        for page in reader.pages:
            width = page.mediabox.width
            height = page.mediabox.height
            if width <= 0 or height <= 0:
                raise PdfSecurityError("PDF_MALFORMED")
            if width > settings.max_pdf_page_dimension_points or (
                height > settings.max_pdf_page_dimension_points
            ):
                raise PdfSecurityError("PDF_CONTENT_LIMIT")
            total_stream_bytes += _content_stream_bytes(page, settings)
            if total_stream_bytes > settings.max_pdf_stream_bytes:
                raise PdfSecurityError("PDF_CONTENT_LIMIT")
    finally:
        reader.close()


def _content_stream_bytes(page: Any, settings: ParserSettings) -> int:
    total = 0
    try:
        contents = page.get_contents()
    except (PdfReadError, ValueError, AttributeError):
        return 0
    if not contents:
        return 0
    for stream in contents:
        try:
            total += len(stream.get_data())
        except (PdfReadError, ValueError, AttributeError):
            continue
        if total > settings.max_pdf_stream_bytes:
            raise PdfSecurityError("PDF_CONTENT_LIMIT")
    return total
