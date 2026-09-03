# ruff: noqa: E501

import csv
import io
import re
import unicodedata
from datetime import datetime
from decimal import Decimal, InvalidOperation
from typing import Any, Literal, cast

from .models import (
    CsvMapping,
    CsvMappingResult,
    CsvParsedCandidate,
    CsvParserResult,
    CsvParserSource,
)

MAX_ROWS = 50_000
MAX_FIELD_LENGTH = 20_000
MAX_LINE_LENGTH = 100_000
DELIMITERS = [",", ";", "\t", "|"]


def _decode(content: bytes) -> tuple[str, str]:
    if b"\x00" in content:
        raise ValueError("null_byte")
    for encoding in ("utf-8-sig", "utf-8", "cp1254", "cp1252"):
        try:
            return content.decode(encoding), encoding
        except UnicodeDecodeError:
            continue
    raise ValueError("unsupported_encoding")


def _delimiter(sample: str) -> str:
    scores = {
        candidate: sum(line.count(candidate) for line in sample.splitlines()[:20])
        for candidate in DELIMITERS
    }
    best = max(scores, key=lambda item: scores[item])
    return best if scores[best] > 0 else ","


def _clean(value: str | None) -> str:
    if value is None:
        return ""
    return unicodedata.normalize("NFKC", value).replace("\x00", "").strip()


def _header_score(header: str, field: str) -> int:
    normalized = re.sub(r"[^a-z0-9ğüşöçıİıأ-ي]+", "", header.casefold())
    aliases = {
        "bookingDate": ["date", "transactiondate", "bookingdate", "işlemtarihi", "tarih", "تاريخ"],
        "valueDate": ["valuedate", "valör", "valordate"],
        "description": [
            "description",
            "details",
            "memo",
            "narrative",
            "açıklama",
            "açiklama",
            "aciklama",
            "detay",
            "البيان",
            "الوصف",
        ],
        "amount": ["amount", "value", "tutar", "المبلغ"],
        "debit": ["debit", "withdrawal", "out", "borç", "borc", "مدين"],
        "credit": ["credit", "deposit", "in", "alacak", "دائن"],
        "currency": ["currency", "ccy", "para", "döviz", "العملة"],
        "balance": ["balance", "runningbalance", "bakiye", "الرصيد"],
        "counterparty": [
            "counterparty",
            "merchant",
            "payee",
            "beneficiary",
            "karşıtaraf",
            "المستفيد",
        ],
        "transactionIdentifier": ["id", "reference", "ref", "transactionid", "işlemno", "المرجع"],
    }
    return max(
        (
            len(alias)
            for alias in aliases[field]
            if re.sub(r"[^a-z0-9ğüşöçıİıأ-ي]+", "", alias.casefold()) in normalized
        ),
        default=0,
    )


def infer_mapping(headers: list[str]) -> tuple[CsvMapping, str, float, list[str]]:
    chosen: dict[str, int | None] = {}
    warnings: list[str] = []
    ambiguous = False
    for field in (
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
    ):
        scores = sorted(
            ((_header_score(header, field), index) for index, header in enumerate(headers)),
            reverse=True,
        )
        best = scores[0] if scores else (0, 0)
        second = scores[1] if len(scores) > 1 else (0, 0)
        if best[0] == 0:
            chosen[field] = None
        elif best[0] == second[0] and best[0] > 0:
            chosen[field] = None
            ambiguous = True
        else:
            chosen[field] = best[1]
    if chosen["amount"] is None and chosen["debit"] is None and chosen["credit"] is None:
        ambiguous = True
        warnings.append("missing_amount_mapping")
    if chosen["bookingDate"] is None:
        ambiguous = True
        warnings.append("missing_booking_date_mapping")
    if chosen["description"] is None:
        ambiguous = True
        warnings.append("missing_description_mapping")
    mapping = CsvMapping(
        headerRow=0, decimalSeparator=None, thousandsSeparator=None, dateFormat=None, **chosen
    )
    status = "ambiguous" if ambiguous else "confident"
    confidence = 0.55 if ambiguous else 0.92
    return mapping, status, confidence, warnings


def _parse_date(value: str, date_format: str | None) -> str | None:
    value = _clean(value)
    if not value:
        return None
    formats = (
        [date_format]
        if date_format
        else ["%Y-%m-%d", "%d.%m.%Y", "%d/%m/%Y", "%m/%d/%Y", "%d-%m-%Y"]
    )
    for fmt in formats:
        if not fmt:
            continue
        try:
            return datetime.strptime(value, fmt).date().isoformat()
        except ValueError:
            pass
    return None


def _decimal(
    value: str, decimal_separator: str | None = None, thousands_separator: str | None = None
) -> str | None:
    raw = _clean(value).replace("\u00a0", " ")
    if not raw:
        return None
    negative = raw.startswith("-") or raw.endswith("-") or raw.startswith("(") and raw.endswith(")")
    raw = raw.strip("-() ").replace(" ", "")
    if thousands_separator:
        raw = raw.replace(thousands_separator, "")
    elif decimal_separator == "," and raw.count(",") == 1:
        pass
    elif raw.count(",") > 0 and raw.count(".") == 0:
        raw = raw.replace(",", "") if raw.count(",") > 1 else raw.replace(",", ".")
    if decimal_separator == ",":
        raw = raw.replace(".", "").replace(",", ".")
    try:
        number = Decimal(raw)
    except InvalidOperation:
        return None
    if not number.is_finite():
        return None
    if number < 0:
        negative = True
        number = -number
    formatted = format(number, "f")
    formatted = formatted.rstrip("0").rstrip(".") if "." in formatted else formatted
    whole, _, fraction = formatted.partition(".")
    if len(whole.lstrip("0") or "0") > 14 or len(fraction) > 6:
        return None
    return f"-{formatted}" if negative and formatted != "0" else formatted


def _value(row: list[str], index: int | None) -> str:
    return _clean(row[index]) if index is not None and index < len(row) else ""


def parse_csv(
    content: bytes, filename: str, media_type: str, mapping_override: dict[str, Any] | None = None
) -> CsvParserResult:
    text, encoding = _decode(content)
    if any(len(line) > MAX_LINE_LENGTH for line in text.splitlines()):
        raise ValueError("line_limit_exceeded")
    delimiter = _delimiter(text[:100_000])
    rows = list(csv.reader(io.StringIO(text), delimiter=delimiter, quotechar='"'))
    if not rows:
        raise ValueError("empty_csv")
    if len(rows) > MAX_ROWS + 1:
        raise ValueError("row_limit_exceeded")
    if any(len(cell) > MAX_FIELD_LENGTH for row in rows for cell in row):
        raise ValueError("field_limit_exceeded")
    headers = [_clean(cell) or f"column_{index + 1}" for index, cell in enumerate(rows[0])]
    mapping_warnings: list[str]
    if mapping_override:
        mapping = CsvMapping.model_validate(mapping_override)
        mapping_status, mapping_confidence, mapping_warnings = "confident", 1.0, []
    else:
        mapping, mapping_status, mapping_confidence, mapping_warnings = infer_mapping(headers)
    source = CsvParserSource(
        filename=filename,
        mediaType=media_type,
        encoding=encoding,
        delimiter=delimiter,
        quoteChar='"',
        headerRow=mapping.headerRow,
        detectedLanguage=None,
        decimalSeparator=mapping.decimalSeparator,
        thousandsSeparator=mapping.thousandsSeparator,
        dateFormat=mapping.dateFormat,
    )
    candidates: list[CsvParsedCandidate] = []
    for offset, row in enumerate(rows[mapping.headerRow + 1 :], start=mapping.headerRow + 2):
        if not any(_clean(cell) for cell in row):
            continue
        payload = {
            headers[index]: _clean(row[index]) if index < len(row) else ""
            for index in range(len(headers))
        }
        raw_amount = _value(row, mapping.amount)
        raw_debit = _value(row, mapping.debit)
        raw_credit = _value(row, mapping.credit)
        debit = _decimal(raw_debit, mapping.decimalSeparator, mapping.thousandsSeparator)
        credit = _decimal(raw_credit, mapping.decimalSeparator, mapping.thousandsSeparator)
        amount = _decimal(raw_amount, mapping.decimalSeparator, mapping.thousandsSeparator)
        direction = "unknown"
        if credit is not None and debit is None:
            amount, direction = credit, "credit"
        elif debit is not None and credit is None:
            amount, direction = debit, "debit"
        elif amount is not None:
            direction = "debit" if amount.startswith("-") else "credit"
            amount = amount.lstrip("-")
        warnings: list[str] = []
        if amount is None:
            warnings.append("invalid_amount")
        if direction == "unknown":
            warnings.append("unknown_direction")
        booking_raw = _value(row, mapping.bookingDate)
        value_raw = _value(row, mapping.valueDate)
        booking_date = _parse_date(booking_raw, mapping.dateFormat)
        value_date = _parse_date(value_raw, mapping.dateFormat)
        if booking_raw and booking_date is None:
            warnings.append("invalid_booking_date")
        raw_currency = _value(row, mapping.currency).upper() or None
        currency = (
            raw_currency if raw_currency and re.fullmatch(r"[A-Z]{3}", raw_currency) else None
        )
        if raw_currency and currency is None:
            warnings.append("invalid_currency")
        balance_raw = _value(row, mapping.balance)
        counterparty = _value(row, mapping.counterparty) or None
        transaction_id = _value(row, mapping.transactionIdentifier) or None
        description = _value(row, mapping.description)
        if not description:
            warnings.append("missing_description")
        candidates.append(
            CsvParsedCandidate(
                sourceRow=offset,
                rawPayload=payload,
                rawDescription=description,
                rawBookingDate=booking_raw or None,
                rawValueDate=value_raw or None,
                rawAmount=raw_amount or raw_debit or raw_credit or None,
                rawCurrency=raw_currency,
                rawBalance=balance_raw or None,
                bookingDate=booking_date,
                valueDate=value_date,
                amount=amount,
                currency=currency,
                direction=cast(Literal["credit", "debit", "unknown"], direction),
                balanceAfter=_decimal(
                    balance_raw, mapping.decimalSeparator, mapping.thousandsSeparator
                ),
                counterparty=counterparty,
                bankTransactionId=transaction_id,
                confidence=max(0.0, 1.0 - min(len(warnings), 5) * 0.15),
                fieldConfidence={
                    "bookingDate": 1.0 if booking_date else 0.0,
                    "description": 1.0 if description else 0.0,
                    "amount": 1.0 if amount else 0.0,
                },
                warnings=warnings,
            )
        )
    return CsvParserResult(
        contractVersion="racio.parser.v2",
        source=source,
        mapping=CsvMappingResult(
            status=cast(Literal["confident", "ambiguous", "invalid"], mapping_status),
            columns=mapping,
            confidence=mapping_confidence,
            warnings=mapping_warnings,
        ),
        candidates=candidates,
        warnings=mapping_warnings,
    )
