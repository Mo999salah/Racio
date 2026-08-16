from __future__ import annotations

import io
import posixpath
import re
import zipfile
from dataclasses import dataclass
from pathlib import PurePosixPath
from xml.etree import ElementTree

from .config import ParserSettings

OOXML_WORKBOOK_CONTENT_TYPE = (
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"
)
RELATIONSHIP_TAG = "{http://schemas.openxmlformats.org/package/2006/relationships}Relationship"
OVERRIDE_TAG = "{http://schemas.openxmlformats.org/package/2006/content-types}Override"
FORBIDDEN_PART_PATTERNS = (
    re.compile(r"(^|/)vbaProject\.bin$", re.IGNORECASE),
    re.compile(r"(^|/)activeX/", re.IGNORECASE),
    re.compile(r"(^|/)embeddings/", re.IGNORECASE),
    re.compile(r"(^|/)externalLinks/", re.IGNORECASE),
    re.compile(r"(^|/)connections\.xml$", re.IGNORECASE),
    re.compile(r"(^|/)queryTables/", re.IGNORECASE),
    re.compile(r"(^|/)media/", re.IGNORECASE),
)


class XlsxSecurityError(ValueError):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


@dataclass(frozen=True)
class ArchiveSummary:
    total_uncompressed_bytes: int
    entry_count: int
    shared_string_count: int


def _safe_xml(payload: bytes) -> ElementTree.Element:
    prefix = payload[:8_192].upper()
    if b"<!DOCTYPE" in prefix or b"<!ENTITY" in prefix:
        raise XlsxSecurityError("XLSX_INVALID_XML")
    try:
        return ElementTree.fromstring(payload)
    except ElementTree.ParseError as error:
        raise XlsxSecurityError("XLSX_INVALID_XML") from error


def _safe_entry_name(name: str) -> bool:
    if not name or "\\" in name or "\x00" in name or name.startswith("/"):
        return False
    path = PurePosixPath(name)
    if path.is_absolute() or any(part in {"", ".", ".."} for part in path.parts):
        return False
    return not re.match(r"^[A-Za-z]:", name)


def _read_part(archive: zipfile.ZipFile, name: str, limit: int) -> bytes:
    try:
        info = archive.getinfo(name)
    except KeyError as error:
        raise XlsxSecurityError("XLSX_INVALID_WORKBOOK") from error
    if info.file_size > limit:
        raise XlsxSecurityError("XLSX_ARCHIVE_LIMIT_EXCEEDED")
    return archive.read(info)


def _validate_relationships(archive: zipfile.ZipFile, names: set[str]) -> None:
    for name in names:
        if not name.endswith(".rels"):
            continue
        root = _safe_xml(_read_part(archive, name, 4 * 1024 * 1024))
        for relationship in root.iter(RELATIONSHIP_TAG):
            if relationship.attrib.get("TargetMode", "").casefold() == "external":
                raise XlsxSecurityError("XLSX_EXTERNAL_LINKS_UNSUPPORTED")
            target = relationship.attrib.get("Target", "")
            if not target:
                continue
            lowered = target.casefold()
            if "://" in lowered or lowered.startswith(("file:", "mailto:", "data:")):
                raise XlsxSecurityError("XLSX_EXTERNAL_LINKS_UNSUPPORTED")
            if target.startswith("//") or "\\" in target:
                raise XlsxSecurityError("XLSX_PATH_TRAVERSAL")
            if target.startswith("/"):
                resolved = posixpath.normpath(target.lstrip("/"))
            else:
                source_part = name.replace("_rels/", "")
                if source_part.endswith(".rels"):
                    source_part = source_part[: -len(".rels")]
                base = posixpath.dirname(source_part)
                resolved = posixpath.normpath(posixpath.join(base, target))
            if resolved == ".." or resolved.startswith("../"):
                raise XlsxSecurityError("XLSX_PATH_TRAVERSAL")
            if resolved not in names:
                raise XlsxSecurityError("XLSX_INVALID_WORKBOOK")


def validate_xlsx_archive(content: bytes, settings: ParserSettings) -> ArchiveSummary:
    if len(content) == 0 or len(content) > settings.max_xlsx_archive_bytes:
        raise XlsxSecurityError("XLSX_ARCHIVE_LIMIT_EXCEEDED")
    if content.startswith(b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"):
        raise XlsxSecurityError("XLSX_PASSWORD_PROTECTED")
    if not content.startswith(b"PK\x03\x04"):
        raise XlsxSecurityError("XLSX_INVALID_WORKBOOK")

    try:
        archive = zipfile.ZipFile(io.BytesIO(content))
        infos = archive.infolist()
    except (zipfile.BadZipFile, OSError) as error:
        raise XlsxSecurityError("XLSX_INVALID_WORKBOOK") from error

    with archive:
        if len(infos) > settings.max_xlsx_zip_entries:
            raise XlsxSecurityError("XLSX_ARCHIVE_LIMIT_EXCEEDED")
        names: set[str] = set()
        total_compressed = 0
        total_uncompressed = 0
        for info in infos:
            if not _safe_entry_name(info.filename):
                raise XlsxSecurityError("XLSX_PATH_TRAVERSAL")
            if info.filename in names:
                raise XlsxSecurityError("XLSX_INVALID_WORKBOOK")
            names.add(info.filename)
            if info.flag_bits & 0x1:
                raise XlsxSecurityError("XLSX_PASSWORD_PROTECTED")
            total_compressed += info.compress_size
            total_uncompressed += info.file_size
            if total_uncompressed > settings.max_xlsx_uncompressed_bytes:
                raise XlsxSecurityError("XLSX_ARCHIVE_LIMIT_EXCEEDED")
            if info.file_size and info.compress_size == 0:
                raise XlsxSecurityError("XLSX_ARCHIVE_LIMIT_EXCEEDED")
            if (
                info.compress_size
                and info.file_size / info.compress_size > settings.max_xlsx_compression_ratio
            ):
                raise XlsxSecurityError("XLSX_ARCHIVE_LIMIT_EXCEEDED")
        if total_compressed and (
            total_uncompressed / total_compressed > settings.max_xlsx_compression_ratio
        ):
            raise XlsxSecurityError("XLSX_ARCHIVE_LIMIT_EXCEEDED")

        required = {"[Content_Types].xml", "_rels/.rels", "xl/workbook.xml"}
        if not required.issubset(names):
            raise XlsxSecurityError("XLSX_INVALID_WORKBOOK")
        if any(name.casefold().endswith("vbaproject.bin") for name in names):
            raise XlsxSecurityError("XLSX_MACRO_ENABLED")
        if any(pattern.search(name) for name in names for pattern in FORBIDDEN_PART_PATTERNS):
            if any("externalLinks/" in name for name in names):
                raise XlsxSecurityError("XLSX_EXTERNAL_LINKS_UNSUPPORTED")
            raise XlsxSecurityError("XLSX_UNSUPPORTED_CONTENT")

        content_types = _safe_xml(_read_part(archive, "[Content_Types].xml", 4 * 1024 * 1024))
        workbook_types = {
            node.attrib.get("ContentType", "")
            for node in content_types.iter(OVERRIDE_TAG)
            if node.attrib.get("PartName") == "/xl/workbook.xml"
        }
        all_types = {
            node.attrib.get("ContentType", "") for node in content_types.iter(OVERRIDE_TAG)
        }
        if OOXML_WORKBOOK_CONTENT_TYPE not in workbook_types:
            if any("macroEnabled" in value for value in all_types):
                raise XlsxSecurityError("XLSX_MACRO_ENABLED")
            raise XlsxSecurityError("XLSX_INVALID_WORKBOOK")
        if any(
            marker in value.casefold()
            for value in all_types
            for marker in ("macroenabled", "vba", "activex", "oleobject")
        ):
            raise XlsxSecurityError("XLSX_MACRO_ENABLED")

        _safe_xml(_read_part(archive, "xl/workbook.xml", 8 * 1024 * 1024))
        _validate_relationships(archive, names)
        for name in names:
            if not name.endswith((".xml", ".rels")):
                continue
            if name.startswith("xl/worksheets/") or name == "xl/sharedStrings.xml":
                continue
            _safe_xml(_read_part(archive, name, 8 * 1024 * 1024))

        shared_string_count = 0
        if "xl/sharedStrings.xml" in names:
            shared_root = _safe_xml(
                _read_part(archive, "xl/sharedStrings.xml", settings.max_xlsx_uncompressed_bytes)
            )
            for node in shared_root:
                if node.tag.endswith("}si") or node.tag == "si":
                    shared_string_count += 1
                    if shared_string_count > settings.max_xlsx_shared_strings:
                        raise XlsxSecurityError("XLSX_SHARED_STRING_LIMIT_EXCEEDED")
                    if len("".join(node.itertext())) > settings.max_xlsx_cell_string_length:
                        raise XlsxSecurityError("XLSX_CELL_STRING_LIMIT_EXCEEDED")

        return ArchiveSummary(
            total_uncompressed_bytes=total_uncompressed,
            entry_count=len(infos),
            shared_string_count=shared_string_count,
        )
