# ruff: noqa: E501
from __future__ import annotations

import io
import re
import unicodedata
from collections import Counter
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Literal, cast

import pdfplumber

from .config import ParserSettings
from .csv_parser import _clean, _decimal, _header_score
from .models import (
    PdfBoundingBox,
    PdfColumnBand,
    PdfInspection,
    PdfMapping,
    PdfMappingResult,
    PdfPageInspection,
    PdfParsedCandidate,
    PdfParserResult,
    PdfParserSource,
    PdfStatementMetadata,
)
from .pdf_security import PdfSecurityError, validate_pdf_container

DATE_FORMATS = (
    "%d/%m/%Y",
    "%d.%m.%Y",
    "%d-%m-%Y",
    "%Y-%m-%d",
    "%Y/%m/%d",
    "%d/%m/%y",
    "%d.%m.%y",
)
YEARLESS_FORMATS = ("%d/%m", "%d.%m", "%d-%m")
MONTH_FORMATS = ("%d %b %Y", "%d %B %Y", "%b %d, %Y", "%B %d, %Y")
MONTH_NAMES = {
    "jan": 1,
    "feb": 2,
    "mar": 3,
    "apr": 4,
    "may": 5,
    "jun": 6,
    "jul": 7,
    "aug": 8,
    "sep": 9,
    "oct": 10,
    "nov": 11,
    "dec": 12,
    "january": 1,
    "february": 2,
    "march": 3,
    "april": 4,
    "june": 6,
    "july": 7,
    "august": 8,
    "september": 9,
    "october": 10,
    "november": 11,
    "december": 12,
    "ocak": 1,
    "şubat": 2,
    "şub": 2,
    "mart": 3,
    "nisan": 4,
    "mayıs": 5,
    "mayis": 5,
    "haziran": 6,
    "temmuz": 7,
    "ağustos": 8,
    "agustos": 8,
    "eylül": 9,
    "eylul": 9,
    "ekim": 10,
    "kasım": 11,
    "kasim": 11,
    "aralık": 12,
    "aralik": 12,
    "يناير": 1,
    "فبراير": 2,
    "مارس": 3,
    "أبريل": 4,
    "ابريل": 4,
    "مايو": 5,
    "يونيو": 6,
    "يوليو": 7,
    "أغسطس": 8,
    "اغسطس": 8,
    "سبتمبر": 9,
    "أكتوبر": 10,
    "اكتوبر": 10,
    "نوفمبر": 11,
    "ديسمبر": 12,
}
ARABIC_RANGE = re.compile(r"[\u0600-\u06ff\u0750-\u077f\ufb50-\ufdff\ufe70-\ufeff]")
DATE_TOKEN = re.compile(r"^\d{1,2}([/.\-])\d{1,2}((?:[/.\-])\d{2,4})?$")
AMOUNT_TOKEN = re.compile(r"[-+()]?\s*(?:\d[\d.,\s]*\d|\d)")
ISO_CURRENCY = re.compile(r"^[A-Z]{3}$")
MASKED_ACCOUNT = re.compile(
    r"(?:\u2022|•|\*)\s*\d{2,4}(?:[\s-]\d{2,4})?"
    r"|\d{2,4}(?:[\s-]\d{2,4})?\s*(?:\u2022|•|\*)"
)
SUMMARY_WORDS = {
    "total",
    "totals",
    "summary",
    "subtotal",
    "closingbalance",
    "openingbalance",
    "finalbalance",
    "toplam",
    "geneltoplam",
    "kapanışbakiyesi",
    "kapanisbakiyesi",
    "acilisbakiyesi",
    "الاجمالي",
    "الإجمالي",
    "المجموع",
    "الرصيدالختامي",
    "الرصيدالافتتاحي",
    "الرصيداالفتتاحي",
    "الرصيد",
}
FOOTER_PATTERN = re.compile(
    r"^(page\s*\d+|sayfa\s*\d+|صفحة\s*\d+|\d+\s+of\s+\d+|confidential|gizli|سري)\b",
    re.IGNORECASE,
)
PERIOD_PATTERN = re.compile(
    r"^(statement\s*period|period|dönem|hesap\s*dönemi|الفترة|فترة)\s*[:：]",
    re.IGNORECASE,
)
OPENING_BALANCE_LABELS = (
    "openingbalance",
    "acilisbakiyesi",
    "açılışbakiyesi",
    "الرصيدالافتتاحي",
    "الرصيداالفتتاحي",
)
CLOSING_BALANCE_LABELS = (
    "closingbalance",
    "finalbalance",
    "kapanışbakiyesi",
    "kapanisbakiyesi",
    "الرصيدالختامي",
)
BALANCE_LABELS = (*OPENING_BALANCE_LABELS, *CLOSING_BALANCE_LABELS)
TOTAL_PREFIXES = (
    "totaldebits",
    "totalcredits",
    "totalpayments",
    "totalreceipts",
    "toplamborc",
    "toplamalacak",
    "geneltoplam",
    "إجمالي",
    "مجموع",
)
FIELDS = (
    "bookingDate",
    "valueDate",
    "description",
    "amount",
    "debit",
    "credit",
    "currency",
    "balance",
    "counterparty",
    "transactionIdentifier",
)
DIRECTION_MARKERS = {
    "dr": "debit",
    "borç": "debit",
    "borc": "debit",
    "المدين": "debit",
    "cr": "credit",
    "alacak": "credit",
    "الدائن": "credit",
    "دائن": "credit",
}
LINE_HEIGHT = 14.0
CONTINUATION_VERTICAL_TOLERANCE = 3.2
MAX_RAW_LINES = 8
MAX_RAW_LINE_LENGTH = 2_000
MIN_TEXT_CHARS = 40
MAX_DESCRIPTION_CHARS = 20_000
MAX_CANDIDATE_DESCRIPTION_CHARS = 1_000


@dataclass(frozen=True)
class PdfWord:
    text: str
    x0: float
    x1: float


@dataclass
class VisualLine:
    page: int
    top: float
    bottom: float
    x0: float
    x1: float
    words: list[PdfWord]
    text: str = ""
    rtl: bool = False


@dataclass
class Band:
    x0: float
    x1: float


@dataclass
class Layout:
    date_format: str | None
    has_year: bool
    decimal_separator: Literal[".", ","] | None
    thousands_separator: Literal[".", ",", " "] | None
    amount_mode: Literal["signed", "debit_credit", "unknown"]
    bands: dict[str, Band]
    header_labels: list[str]
    source_pages: list[int]
    warnings: list[str] = field(default_factory=list)


@dataclass
class PendingRow:
    page: int
    lines: list[VisualLine]
    date_raw: str
    date_iso: str | None
    date_ambiguous: bool
    description_words: list[PdfWord]
    debit_raw: str | None
    credit_raw: str | None
    amount_raw: str | None
    balance_raw: str | None
    currency_raw: str | None
    direction_marker: str | None
    inferred_year: bool


def inspect_pdf(content: bytes, settings: ParserSettings) -> PdfInspection:
    validate_pdf_container(content, settings)
    with pdfplumber.open(io.BytesIO(content)) as pdf:
        if len(pdf.pages) > settings.max_pdf_pages:
            raise PdfSecurityError("PDF_TOO_MANY_PAGES")
        pages: list[PdfPageInspection] = []
        total_chars = 0
        total_printable = 0
        total_image_area = 0.0
        total_page_area = 0.0
        image_pages = 0
        for index, page in enumerate(pdf.pages, start=1):
            text = page.extract_text() or ""
            if len(text) > settings.max_pdf_chars_per_page:
                raise PdfSecurityError("PDF_CONTENT_LIMIT")
            words = page.extract_words()
            if len(words) > settings.max_pdf_words_per_page:
                raise PdfSecurityError("PDF_CONTENT_LIMIT")
            images = page.images
            image_area = sum(
                (item["x1"] - item["x0"]) * (item["bottom"] - item["top"]) for item in images
            )
            page_area = max(1.0, float(page.width) * float(page.height))
            if image_area > 0:
                image_pages += 1
            total_image_area += image_area
            total_page_area += page_area
            printable = sum(1 for char in text if unicodedata.category(char)[0] not in {"C", "Z"})
            total_chars += len(text)
            total_printable += printable
            lines = page.extract_text_lines() or []
            sample_lines = [_clean(line.get("text", ""))[:200] for line in lines[:5]]
            sample_lines = [line for line in sample_lines if line]
            warnings: list[str] = []
            coverage = image_area / page_area
            if coverage > 0.5 and printable < 50:
                warnings.append("image_dominated_page")
            if images and printable >= 50:
                warnings.append("mixed_text_and_images")
            likely_table = bool(page.lines) or len(words) >= 12
            pages.append(
                PdfPageInspection(
                    pageNumber=index,
                    width=float(page.width),
                    height=float(page.height),
                    textCharacterCount=len(text),
                    wordCount=len(words),
                    imageCount=len(images),
                    likelyTable=likely_table,
                    sampleLines=sample_lines,
                    warnings=warnings,
                )
            )
        if total_chars > settings.max_pdf_total_chars:
            raise PdfSecurityError("PDF_CONTENT_LIMIT")

    has_usable_text = total_printable >= MIN_TEXT_CHARS
    document_warnings: list[str] = []
    if total_page_area > 0 and total_image_area / total_page_area > 0.5 and not has_usable_text:
        document_warnings.append("likely_image_only_document")
    if image_pages and has_usable_text:
        document_warnings.append("mixed_text_and_images")
    if not has_usable_text and total_image_area <= 0:
        document_warnings.append("no_text_no_images")

    text_usability: Literal["usable", "mixed", "image_only", "none"]
    if has_usable_text:
        text_usability = "mixed" if image_pages else "usable"
    elif total_image_area > 0:
        text_usability = "image_only"
    else:
        text_usability = "none"
    return PdfInspection(
        contractVersion="racio.pdf-inspection.v1",
        sourceType="pdf",
        pageCount=len(pages),
        encrypted=False,
        hasUsableText=has_usable_text,
        likelyImageOnly=text_usability == "image_only",
        textUsability=text_usability,
        textCharacterCount=total_chars,
        pages=pages,
        documentWarnings=document_warnings,
    )


def _logical_word_text(text: str) -> str:
    if ARABIC_RANGE.search(text):
        return unicodedata.normalize("NFKC", text[::-1])
    return text


def _visual_lines(pdf: Any) -> list[VisualLine]:
    lines: list[VisualLine] = []
    for index, page in enumerate(pdf.pages, start=1):
        words = page.extract_words()
        if not words:
            continue
        grouped: list[list[dict[str, Any]]] = []
        for word in sorted(words, key=lambda item: (float(item["top"]), float(item["x0"]))):
            word_top = float(word["top"])
            if not grouped or abs(grouped[-1][-1]["top"] - word_top) > 1.0:
                grouped.append([word])
            else:
                grouped[-1].append(word)
        for group in grouped:
            if not group:
                continue
            word_objects: list[PdfWord] = []
            for item in sorted(group, key=lambda entry: float(entry["x0"])):
                text = _clean(str(item.get("text", "")))
                if not text:
                    continue
                word_objects.append(
                    PdfWord(
                        text=_logical_word_text(text),
                        x0=float(item["x0"]),
                        x1=float(item["x1"]),
                    )
                )
            if not word_objects:
                continue
            top = float(min(item["top"] for item in group))
            bottom = float(max(item["bottom"] for item in group))
            x0 = float(min(item["x0"] for item in group))
            x1 = float(max(item["x1"] for item in group))
            rtl = any(ARABIC_RANGE.search(word.text) for word in word_objects)
            ordered = list(reversed(word_objects)) if rtl else word_objects
            lines.append(
                VisualLine(
                    page=index,
                    top=top,
                    bottom=bottom,
                    x0=x0,
                    x1=x1,
                    words=word_objects,
                    text=" ".join(word.text for word in ordered),
                    rtl=rtl,
                )
            )
    return lines


def _month_name_date(value: str) -> str | None:
    normalized = _clean(value)
    words = re.split(r"[\s,]+", normalized)
    parsed: list[str] = []
    for word in words:
        lowered = word.casefold()
        if lowered in MONTH_NAMES:
            parsed.append(f"{MONTH_NAMES[lowered]:02d}")
        else:
            parsed.append(word)
    joined = " ".join(parsed)
    for fmt in MONTH_FORMATS:
        try:
            return datetime.strptime(joined, fmt).date().isoformat()
        except ValueError:
            continue
    return None


def _parse_with_formats(value: str, formats: tuple[str, ...]) -> str | None:
    normalized = _clean(value)
    if not normalized:
        return None
    for fmt in formats:
        try:
            return datetime.strptime(normalized, fmt).date().isoformat()
        except ValueError:
            continue
    return _month_name_date(normalized)


def _match_format(value: str, formats: tuple[str, ...]) -> str | None:
    normalized = _clean(value)
    if not normalized:
        return None
    for fmt in formats:
        try:
            datetime.strptime(normalized, fmt)
            return fmt
        except ValueError:
            continue
    return None


def _date_token(text: str) -> bool:
    normalized = _clean(text)
    if not DATE_TOKEN.match(normalized):
        return False
    parts = re.split(r"[/.\-]", normalized)
    return len(parts) >= 2 and all(part.isdigit() for part in parts)


def _is_full_date(text: str) -> bool:
    normalized = _clean(text)
    match = DATE_TOKEN.match(normalized)
    if not match:
        return False
    parts = re.split(r"[/.\-]", normalized)
    return len(parts) >= 3 and all(part.isdigit() for part in parts)


def _amount_from_word(
    text: str,
    decimal_separator: Literal[".", ","] | None,
    thousands_separator: Literal[".", ",", " "] | None,
) -> tuple[str | None, str]:
    normalized = _clean(text)
    if not normalized:
        return None, normalized
    for candidate in AMOUNT_TOKEN.findall(normalized):
        cleaned = candidate.strip()
        if not cleaned:
            continue
        amount = _decimal(cleaned, decimal_separator, thousands_separator)
        if amount is not None:
            return amount, cleaned
    return None, normalized


def _center(word: PdfWord) -> float:
    return (word.x0 + word.x1) / 2.0


def _within(word: PdfWord, band: Band | None) -> bool:
    if band is None:
        return False
    return word.x1 >= band.x0 and word.x0 <= band.x1


def _overlap(left: Band, right: Band) -> bool:
    return left.x1 >= right.x0 and right.x1 >= left.x0


def _detect_separators(
    lines: list[VisualLine],
) -> tuple[Literal[".", ","] | None, Literal[".", ",", " "] | None]:
    decimals: Counter[str] = Counter()
    thousands: Counter[str] = Counter()
    for line in lines:
        for word in line.words:
            if _is_full_date(word.text):
                continue
            for candidate in AMOUNT_TOKEN.findall(word.text):
                cleaned = candidate.strip()
                if not cleaned:
                    continue
                if "." in cleaned and "," in cleaned:
                    last = cleaned[-3:]
                    if "." in last:
                        decimals["."] += 1
                        thousands[","] += 1
                    else:
                        decimals[","] += 1
                        thousands["."] += 1
                elif "," in cleaned:
                    decimals[","] += 1
                elif "." in cleaned:
                    decimals["."] += 1
    decimal_separator = decimals.most_common(1)[0][0] if decimals else None
    thousand_separator = thousands.most_common(1)[0][0] if thousands else None
    return cast(Literal[".", ","] | None, decimal_separator), cast(
        Literal[".", ",", " "] | None, thousand_separator
    )


def _header_bands(line: VisualLine) -> tuple[dict[str, Band], list[str]]:
    bands: dict[str, Band] = {}
    labels: list[str] = []
    for word in line.words:
        label = _clean(word.text).rstrip(":")
        if not label:
            continue
        labels.append(label)
        scores = {field: _header_score(label, field) for field in FIELDS}
        best = max(scores, key=lambda item: scores[item])
        if scores[best] > 0:
            bands[best] = Band(x0=word.x0, x1=word.x1)
    return bands, labels


def _expanded_bands(line: VisualLine | None, base: dict[str, Band]) -> dict[str, Band]:
    if not line or not line.words:
        return base
    ordered = sorted(line.words, key=lambda word: word.x0)
    expanded: dict[str, Band] = {}
    for idx, word in enumerate(ordered):
        label = _clean(word.text).rstrip(":")
        scores = {field: _header_score(label, field) for field in FIELDS}
        best = max(scores, key=lambda item: scores[item])
        if scores[best] < 3:
            continue
        left_boundary = (ordered[idx - 1].x1 + word.x0) / 2 if idx > 0 else max(0.0, word.x0 - 40.0)
        right_boundary = (
            (word.x1 + ordered[idx + 1].x0) / 2 if idx < len(ordered) - 1 else word.x1 + 40.0
        )
        expanded[best] = Band(x0=left_boundary, x1=right_boundary)
    return expanded


def _is_column_header(line: VisualLine) -> bool:
    if any(re.search(r"\d", word.text) for word in line.words):
        return False
    matched: set[str] = set()
    for word in line.words:
        scores = {field: _header_score(_clean(word.text), field) for field in FIELDS}
        best = max(scores, key=lambda item: scores[item])
        if scores[best] >= 3:
            matched.add(best)
    return len(matched) >= 3


def _structural_headers(lines: list[VisualLine], page_count: int) -> tuple[set[str], set[str]]:
    repeated: Counter[str] = Counter()
    for line in lines:
        if any(_date_token(word.text) for word in line.words):
            continue
        normalized = re.sub(r"\s+", " ", line.text.casefold()).strip()
        if normalized:
            repeated[normalized] += 1
    repeated_text = {text for text, count in repeated.items() if count >= max(2, page_count // 2)}
    column_text: set[str] = set()
    for line in lines:
        if _is_column_header(line):
            column_text.add(re.sub(r"\s+", " ", line.text.casefold()).strip())
    return repeated_text | column_text, column_text


def _infer_date_band(lines: list[VisualLine]) -> Band | None:
    positions: list[float] = []
    for line in lines:
        for word in line.words:
            if _date_token(word.text):
                positions.append(_center(word))
    if not positions:
        return None
    positions.sort()
    clusters: list[list[float]] = []
    for position in positions:
        if clusters and position - clusters[-1][-1] <= 12.0:
            clusters[-1].append(position)
        else:
            clusters.append([position])
    best = max(clusters, key=len)
    return Band(x0=best[0] - 2.0, x1=best[-1] + 2.0)


def _infer_amount_bands(lines: list[VisualLine], exclude: Band | None) -> list[Band]:
    positions: list[float] = []
    for line in lines:
        for word in line.words:
            if _is_full_date(word.text):
                continue
            if exclude and _within(word, exclude):
                continue
            if re.search(r"\d", word.text):
                positions.append(_center(word))
    if not positions:
        return []
    positions.sort()
    clusters: list[list[float]] = []
    for position in positions:
        if clusters and position - clusters[-1][-1] <= 14.0:
            clusters[-1].append(position)
        else:
            clusters.append([position])
    bands = [Band(x0=cluster[0] - 3.0, x1=cluster[-1] + 3.0) for cluster in clusters]
    return sorted(bands, key=lambda band: band.x0, reverse=True)[:3]


def _description_band(
    date_band: Band | None,
    bands: dict[str, Band],
    explicit: Band | None,
) -> Band | None:
    if explicit:
        return explicit
    right: Band | None = None
    for key in ("amount", "debit", "credit", "balance", "currency"):
        if key in bands:
            right = bands[key]
            break
    left = date_band
    if left is None and right is None:
        return None
    if left is None and right is not None:
        return Band(x0=0.0, x1=right.x0)
    if left is not None and right is None:
        return Band(x0=left.x1, x1=left.x1 + 300.0)
    assert left is not None and right is not None
    if (left.x0 + left.x1) / 2 > (right.x0 + right.x1) / 2:
        start, end = right.x1, left.x0
    else:
        start, end = left.x1, right.x0
    return Band(x0=start, x1=max(start + 1.0, end))


def _statement_period(lines: list[VisualLine]) -> tuple[str, str] | None:
    for line in lines:
        if PERIOD_PATTERN.match(line.text.strip()):
            dates: list[str] = []
            for word in line.words:
                parsed = _parse_with_formats(word.text, DATE_FORMATS)
                if parsed:
                    dates.append(parsed)
            if len(dates) >= 2:
                return (min(dates), max(dates))
    return None


def _layout_date_tokens(
    lines: list[VisualLine],
    header_line: VisualLine | None,
    date_band: Band | None,
) -> list[str]:
    header_bottom = header_line.bottom + 2.0 if header_line else None
    tokens: list[str] = []
    for line in lines:
        if header_bottom is not None and line.top <= header_bottom:
            continue
        for word in line.words:
            if date_band and not _within(word, date_band):
                continue
            if _date_token(word.text):
                tokens.append(word.text)
    return tokens


def _detect_layout(
    lines: list[VisualLine],
    override: dict[str, Any] | None,
) -> Layout:
    _structural, column_text = _structural_headers(
        lines, max(1, len({line.page for line in lines}))
    )
    header_line: VisualLine | None = None
    for line in lines:
        if _is_column_header(line):
            header_line = line
            break
    header_bands, header_labels = _header_bands(header_line) if header_line else ({}, [])
    header_bands = _expanded_bands(header_line, header_bands)
    date_band = header_bands.get("bookingDate") or _infer_date_band(lines)

    date_format: str | None = None
    has_year = True
    date_tokens = _layout_date_tokens(lines, header_line, date_band)
    if override and override.get("dateFormat"):
        date_format = str(override["dateFormat"])
        has_year = "Y" in date_format or "y" in date_format
    else:
        candidates: Counter[str] = Counter()
        for token in date_tokens:
            fmt = _match_format(token, DATE_FORMATS)
            if fmt:
                candidates[fmt] += 1
        if candidates:
            date_format = candidates.most_common(1)[0][0]
            has_year = "Y" in date_format or "y" in date_format
        else:
            yearless: Counter[str] = Counter()
            for token in date_tokens:
                fmt = _match_format(token, YEARLESS_FORMATS)
                if fmt:
                    yearless[fmt] += 1
            if yearless:
                date_format = yearless.most_common(1)[0][0]
                has_year = False

    decimal_separator, thousands_separator = _detect_separators(lines)
    if override:
        decimal_separator = (
            cast(Literal[".", ","] | None, override.get("decimalSeparator")) or decimal_separator
        )
        thousands_separator = (
            cast(Literal[".", ",", " "] | None, override.get("thousandsSeparator"))
            or thousands_separator
        )

    balance_band = header_bands.get("balance")
    debit_band = header_bands.get("debit")
    credit_band = header_bands.get("credit")
    amount_band = header_bands.get("amount")

    if debit_band and credit_band:
        amount_mode: Literal["signed", "debit_credit", "unknown"] = "debit_credit"
    elif amount_band:
        amount_mode = "signed"
    else:
        inferred = _infer_amount_bands(lines, date_band)
        if balance_band:
            amount_bands = [band for band in inferred if not _overlap(band, balance_band)]
        else:
            amount_bands = inferred
        if len(amount_bands) >= 2:
            amount_mode = "debit_credit"
            debit_band, credit_band = amount_bands[0], amount_bands[1]
        elif len(amount_bands) == 1:
            amount_mode = "signed"
            amount_band = amount_bands[0]
        else:
            amount_mode = "unknown"
    if override:
        mode_override = override.get("amountColumnMode")
        if mode_override in {"signed", "debit_credit", "unknown"}:
            amount_mode = mode_override

    bands: dict[str, Band] = {}
    if date_band:
        bands["bookingDate"] = date_band
    if header_bands.get("valueDate"):
        bands["valueDate"] = header_bands["valueDate"]
    if amount_band:
        bands["amount"] = amount_band
    if debit_band:
        bands["debit"] = debit_band
    if credit_band:
        bands["credit"] = credit_band
    if balance_band:
        bands["balance"] = balance_band
    if header_bands.get("currency"):
        bands["currency"] = header_bands["currency"]
    if header_bands.get("counterparty"):
        bands["counterparty"] = header_bands["counterparty"]
    if header_bands.get("transactionIdentifier"):
        bands["transactionIdentifier"] = header_bands["transactionIdentifier"]
    description_band = _description_band(date_band, bands, header_bands.get("description"))
    if description_band:
        bands["description"] = description_band

    warnings: list[str] = []
    if date_format is None:
        warnings.append("date_format_not_detected")
    if amount_mode == "unknown":
        warnings.append("amount_column_mode_unknown")
    if column_text:
        warnings.append("column_headers_present")
    source_pages = sorted({line.page for line in lines})
    return Layout(
        date_format=date_format,
        has_year=has_year,
        decimal_separator=decimal_separator,
        thousands_separator=thousands_separator,
        amount_mode=amount_mode,
        bands=bands,
        header_labels=header_labels,
        source_pages=source_pages,
        warnings=warnings,
    )


def _summary_line(line: VisualLine) -> bool:
    normalized = re.sub(r"\W+", "", line.text.casefold())
    if normalized in SUMMARY_WORDS:
        return True
    if any(label in normalized for label in BALANCE_LABELS):
        return True
    if any(prefix in normalized for prefix in TOTAL_PREFIXES):
        return True
    if PERIOD_PATTERN.match(line.text.strip()):
        return True
    return bool(FOOTER_PATTERN.match(line.text.strip()))


def _is_structural(line: VisualLine, structural: set[str]) -> bool:
    normalized = re.sub(r"\s+", " ", line.text.casefold()).strip()
    return normalized in structural


def _parse_balance_metadata(
    lines: list[VisualLine], layout: Layout
) -> tuple[str | None, str | None]:
    opening: str | None = None
    closing: str | None = None
    for line in lines:
        normalized = re.sub(r"\W+", "", line.text.casefold())
        amount = None
        for word in line.words:
            parsed, _raw = _amount_from_word(
                word.text, layout.decimal_separator, layout.thousands_separator
            )
            if parsed is not None:
                amount = parsed
                break
        if amount is None:
            continue
        if any(label in normalized for label in OPENING_BALANCE_LABELS):
            opening = amount
        elif any(label in normalized for label in CLOSING_BALANCE_LABELS):
            closing = amount
    return opening, closing


def _infer_years(rows: list[PendingRow], period: tuple[str, str] | None) -> None:
    if not rows or period is None:
        return
    start_year = int(period[0][:4])
    end_year = int(period[1][:4])
    candidates = [start_year, end_year, start_year + 1, end_year - 1]
    for row in rows:
        if row.date_iso or not row.date_raw:
            continue
        yearless = _parse_with_formats(row.date_raw, YEARLESS_FORMATS)
        if yearless is None:
            continue
        month = int(yearless[5:7])
        day = int(yearless[8:10])
        resolved = None
        for candidate in candidates:
            try:
                iso = f"{candidate:04d}-{month:02d}-{day:02d}"
                datetime.strptime(iso, "%Y-%m-%d")
            except ValueError:
                continue
            if not (period[0] <= iso <= period[1]):
                continue
            resolved = iso
            break
        if resolved:
            row.date_iso = resolved
            row.inferred_year = True


def _direction_marker(text: str) -> str | None:
    lowered = _clean(text).casefold()
    return DIRECTION_MARKERS.get(lowered)


def _amount_word_band(word: PdfWord, layout: Layout) -> str | None:
    for key in ("amount", "debit", "credit"):
        band = layout.bands.get(key)
        if band and _within(word, band):
            return key
    return None


def _assign_row_values(
    row: PendingRow,
    line: VisualLine,
    layout: Layout,
    description_band: Band | None,
) -> None:
    date_band = layout.bands.get("bookingDate")
    value_date_band = layout.bands.get("valueDate")
    for word in line.words:
        if date_band and _within(word, date_band):
            continue
        if value_date_band and _within(word, value_date_band):
            continue
        currency_band = layout.bands.get("currency")
        if currency_band and _within(word, currency_band) and ISO_CURRENCY.fullmatch(word.text):
            if row.currency_raw is None:
                row.currency_raw = word.text
            continue
        balance_band = layout.bands.get("balance")
        if balance_band and _within(word, balance_band) and _looks_like_amount_word(word.text):
            amount, _raw = _amount_from_word(
                word.text, layout.decimal_separator, layout.thousands_separator
            )
            if amount is not None and row.balance_raw is None:
                row.balance_raw = amount
            continue
        amount_field = _amount_word_band(word, layout)
        if amount_field is not None and _looks_like_amount_word(word.text):
            amount, raw = _amount_from_word(
                word.text, layout.decimal_separator, layout.thousands_separator
            )
            if amount is not None:
                _assign_amount(row, amount, raw, amount_field)
            elif amount_field == "amount" and row.amount_raw is None:
                row.amount_raw = word.text
            continue
        marker = _direction_marker(word.text)
        if marker and len(word.text) <= 8 and not (date_band and _within(word, date_band)):
            if row.direction_marker is None:
                row.direction_marker = marker
            continue
    ordered = reversed(line.words) if line.rtl else line.words
    for word in ordered:
        if description_band is None or _within(word, description_band):
            row.description_words.append(word)


def _assign_amount(
    row: PendingRow,
    amount: str,
    raw: str,
    field: str,
) -> None:
    if field == "debit" and row.debit_raw is None:
        row.debit_raw = amount
    elif field == "credit" and row.credit_raw is None:
        row.credit_raw = amount
    elif field == "amount" and row.amount_raw is None:
        row.amount_raw = raw


def _looks_like_amount_word(text: str) -> bool:
    return any(char.isdigit() for char in text)


def _build_rows(
    lines: list[VisualLine],
    layout: Layout,
) -> tuple[list[PendingRow], list[str], str | None, str | None]:
    page_count = max(1, len({line.page for line in lines}))
    structural, _column_text = _structural_headers(lines, page_count)
    rows: list[PendingRow] = []
    open_row: PendingRow | None = None
    parser_warnings: list[str] = []
    date_band = layout.bands.get("bookingDate")
    description_band = layout.bands.get("description")

    for line in lines:
        if _is_structural(line, structural) or _summary_line(line):
            continue
        date_word = None
        if date_band:
            for word in line.words:
                if _within(word, date_band) and _date_token(word.text):
                    date_word = word
                    break

        if date_word is not None:
            parsed_full = _parse_with_formats(date_word.text, DATE_FORMATS)
            row = PendingRow(
                page=line.page,
                lines=[line],
                date_raw=date_word.text,
                date_iso=parsed_full,
                date_ambiguous=parsed_full is None,
                description_words=[],
                debit_raw=None,
                credit_raw=None,
                amount_raw=None,
                balance_raw=None,
                currency_raw=None,
                direction_marker=None,
                inferred_year=False,
            )
            rows.append(row)
            open_row = row
            _assign_row_values(row, line, layout, description_band)
            continue

        if open_row is None:
            continue
        last_bottom = max(item.bottom for item in open_row.lines)
        if line.top - last_bottom > LINE_HEIGHT * CONTINUATION_VERTICAL_TOLERANCE:
            continue
        if description_band and not _overlap(Band(x0=line.x0, x1=line.x1), description_band):
            continue
        open_row.lines.append(line)
        _assign_row_values(open_row, line, layout, description_band)

    opening, closing = _parse_balance_metadata(lines, layout)
    period_dates = [row.date_iso for row in rows if row.date_iso]
    period = _statement_period(lines)
    if period is None and period_dates:
        period = (min(period_dates), max(period_dates))
    _infer_years(rows, period)
    return rows, parser_warnings, opening, closing


def _candidate_from_row(
    row: PendingRow,
    source_index: int,
    layout: Layout,
    detected_currency: str | None,
) -> PdfParsedCandidate:
    warnings: list[str] = []
    amount: str | None
    direction: Literal["credit", "debit", "unknown"]
    if layout.amount_mode == "debit_credit":
        debit = _absolute(row.debit_raw)
        credit = _absolute(row.credit_raw)
        if credit is not None and debit is None:
            amount, direction = credit, "credit"
        elif debit is not None and credit is None:
            amount, direction = debit, "debit"
        elif debit is not None and credit is not None:
            amount, direction = debit, "debit"
            warnings.append("both_debit_and_credit")
        else:
            amount, direction = None, "unknown"
            warnings.append("invalid_amount")
    else:
        if row.amount_raw is not None:
            signed = _decimal(row.amount_raw, layout.decimal_separator, layout.thousands_separator)
            if signed is None:
                amount, direction = None, "unknown"
                warnings.append("invalid_amount")
            else:
                direction = "debit" if signed.startswith("-") else "credit"
                amount = signed.lstrip("-")
        else:
            amount, direction = None, "unknown"
            warnings.append("invalid_amount")

    if row.direction_marker:
        direction = cast(Literal["credit", "debit", "unknown"], row.direction_marker)
    if direction == "unknown":
        warnings.append("unknown_direction")

    if row.date_iso is None:
        warnings.append("ambiguous_booking_date" if row.date_ambiguous else "invalid_booking_date")
    if row.inferred_year:
        warnings.append("year_inferred_from_statement_period")
    description = " ".join(word.text for word in row.description_words).strip()
    if not description:
        warnings.append("missing_description")
    if len(description) > MAX_CANDIDATE_DESCRIPTION_CHARS:
        description = description[:MAX_CANDIDATE_DESCRIPTION_CHARS]
        warnings.append("description_truncated")

    currency = row.currency_raw or detected_currency
    if currency and not ISO_CURRENCY.fullmatch(currency):
        currency = None
        warnings.append("invalid_currency")

    raw_lines = [_clean(item.text)[:MAX_RAW_LINE_LENGTH] for item in row.lines][:MAX_RAW_LINES]
    raw_description = " ".join(item.text for item in row.lines).strip()
    raw_description = raw_description[:MAX_DESCRIPTION_CHARS]
    x0 = min(item.x0 for item in row.lines)
    top = min(item.top for item in row.lines)
    x1 = max(item.x1 for item in row.lines)
    bottom = max(item.bottom for item in row.lines)

    field_confidence = {
        "bookingDate": 1.0 if row.date_iso else 0.0,
        "description": 1.0 if description else 0.0,
        "amount": 1.0 if amount else 0.0,
    }
    confidence = max(0.0, 1.0 - min(len(set(warnings)), 5) * 0.15)
    payload: dict[str, str] = {
        "page": str(row.page),
        "rawDate": row.date_raw,
        "rawLines": raw_lines[-1] if raw_lines else "",
        "directionMarker": row.direction_marker or "",
    }
    return PdfParsedCandidate(
        sourceRow=source_index,
        sourcePage=row.page,
        rawPayload=payload,
        rawDescription=raw_description,
        rawBookingDate=row.date_raw or None,
        rawValueDate=None,
        rawAmount=row.amount_raw or row.debit_raw or row.credit_raw or None,
        rawCurrency=row.currency_raw,
        rawBalance=row.balance_raw,
        bookingDate=row.date_iso,
        valueDate=None,
        amount=amount,
        description=description or None,
        currency=currency,
        direction=direction,
        balanceAfter=row.balance_raw,
        counterparty=None,
        bankTransactionId=None,
        confidence=confidence,
        fieldConfidence=field_confidence,
        warnings=list(dict.fromkeys(warnings)),
        rawLines=raw_lines,
        boundingBox=PdfBoundingBox(x0=x0, top=top, x1=x1, bottom=bottom),
        parserStrategy="date_ledger_column_bands",
    )


def _absolute(value: str | None) -> str | None:
    if value is None:
        return None
    return value.lstrip("-")


def _detect_statement_metadata(
    lines: list[VisualLine],
    layout: Layout,
    opening: str | None,
    closing: str | None,
    rows: list[PendingRow],
) -> PdfStatementMetadata:
    currency_counter: Counter[str] = Counter()
    for line in lines:
        if _is_column_header(line) or _summary_line(line):
            continue
        for word in line.words:
            if ISO_CURRENCY.fullmatch(word.text):
                currency_counter[word.text] += 1
    currency = currency_counter.most_common(1)[0][0] if currency_counter else None
    period_dates = [row.date_iso for row in rows if row.date_iso]
    period_start = min(period_dates) if period_dates else None
    period_end = max(period_dates) if period_dates else None
    institution_text: str | None = None
    masked_account: str | None = None
    for line in lines:
        if line.top < 60 and not _is_column_header(line) and not _summary_line(line):
            if institution_text is None and line.text.strip():
                institution_text = line.text.strip()[:200]
        for word in line.words:
            match = MASKED_ACCOUNT.search(word.text)
            if match and masked_account is None:
                masked_account = match.group(0)[:80]
    return PdfStatementMetadata(
        periodStart=period_start,
        periodEnd=period_end,
        openingBalance=opening,
        closingBalance=closing,
        currency=currency,
        institutionNameText=institution_text,
        maskedAccountIdentifier=masked_account,
    )


def parse_pdf(
    content: bytes,
    filename: str,
    media_type: str,
    settings: ParserSettings,
    mapping_override: dict[str, Any] | None = None,
) -> PdfParserResult:
    inspection = inspect_pdf(content, settings)
    if not inspection.hasUsableText:
        raise PdfSecurityError("PDF_NO_USABLE_TEXT")
    with pdfplumber.open(io.BytesIO(content)) as pdf:
        lines = _visual_lines(pdf)

    layout = _detect_layout(lines, mapping_override)
    rows, parser_warnings, opening, closing = _build_rows(lines, layout)
    metadata = _detect_statement_metadata(lines, layout, opening, closing, rows)

    candidates: list[PdfParsedCandidate] = []
    if rows:
        for index, row in enumerate(rows, start=1):
            candidates.append(_candidate_from_row(row, index, layout, metadata.currency))
    if len(candidates) > settings.max_pdf_candidates:
        raise PdfSecurityError("PDF_CONTENT_LIMIT")

    ambiguous = layout.date_format is None or layout.amount_mode == "unknown" or not candidates
    status: Literal["confident", "ambiguous", "invalid"] = (
        "invalid" if not rows else "ambiguous" if ambiguous else "confident"
    )
    warnings = list(dict.fromkeys([*layout.warnings, *parser_warnings]))
    if not rows:
        warnings.append("no_transaction_rows_found")
    mapping = PdfMapping(
        sourceType="pdf",
        pageCount=inspection.pageCount,
        sourcePages=layout.source_pages,
        headerLabels=layout.header_labels[:100],
        columnBands=[
            PdfColumnBand(label=label, x0=band.x0, x1=band.x1)
            for label, band in layout.bands.items()
        ][:100],
        amountColumnMode=layout.amount_mode,
        lineGroupingStrategy="date_ledger_column_bands",
        hasYear=layout.has_year,
        decimalSeparator=layout.decimal_separator,
        thousandsSeparator=layout.thousands_separator,
        dateFormat=layout.date_format,
    )
    return PdfParserResult(
        contractVersion="racio.parser.v2",
        source=PdfParserSource(
            sourceType="pdf",
            filename=filename,
            mediaType=media_type,
            pageCount=inspection.pageCount,
            detectedLanguage=None,
            amountColumnMode=layout.amount_mode,
            hasYear=layout.has_year,
            decimalSeparator=layout.decimal_separator,
            thousandsSeparator=layout.thousands_separator,
            dateFormat=layout.date_format,
        ),
        mapping=PdfMappingResult(
            status=status,
            columns=mapping,
            confidence=0.55 if status == "ambiguous" else 0.92,
            warnings=warnings,
        ),
        candidates=candidates,
        metadata=metadata,
        warnings=warnings,
    )
