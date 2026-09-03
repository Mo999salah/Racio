from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from racio_parser.config import ParserSettings
from racio_parser.main import app
from racio_parser.pdf_parser import (
    Band,
    Layout,
    PdfWord,
    PendingRow,
    VisualLine,
    _candidate_from_row,
    _detect_layout,
    inspect_pdf,
    parse_pdf,
)
from racio_parser.pdf_security import PdfSecurityError

FIXTURES = Path(__file__).resolve().parents[3] / "fixtures" / "statements" / "pdf"
MEDIA_TYPE = "application/pdf"
client = TestClient(app)


def fixture(name: str) -> bytes:
    return (FIXTURES / name).read_bytes()


def test_candidate_description_is_truncated_to_contract_limit() -> None:
    description_words = [PdfWord(text="x" * 1_001, x0=10, x1=20)]
    line = VisualLine(
        page=1,
        top=10,
        bottom=20,
        x0=10,
        x1=20,
        words=description_words,
        text="x" * 1_001,
    )
    row = PendingRow(
        page=1,
        lines=[line],
        date_raw="01/08/2026",
        date_iso="2026-08-01",
        date_ambiguous=False,
        description_words=description_words,
        debit_raw=None,
        credit_raw=None,
        amount_raw="12.50",
        balance_raw="100",
        currency_raw="TRY",
        direction_marker=None,
        inferred_year=False,
    )
    layout = Layout(
        date_format="%d/%m/%Y",
        has_year=True,
        decimal_separator=".",
        thousands_separator=",",
        amount_mode="signed",
        bands={"description": Band(10, 20)},
        header_labels=[],
        source_pages=[1],
    )

    candidate = _candidate_from_row(row, 1, layout, "TRY")

    assert candidate.description is not None
    assert len(candidate.description) == 1_000
    assert "description_truncated" in candidate.warnings
    assert len(candidate.rawDescription) == 1_001
    assert candidate.bookingDate == "2026-08-01"
    assert candidate.amount == "12.5"
    assert candidate.direction == "credit"


def test_detect_layout_uses_detected_description_header_band() -> None:
    header = VisualLine(
        page=1,
        top=10,
        bottom=20,
        x0=10,
        x1=280,
        words=[
            PdfWord(text="Date", x0=10, x1=20),
            PdfWord(text="Amount", x0=100, x1=120),
            PdfWord(text="Balance", x0=140, x1=160),
            PdfWord(text="Description", x0=200, x1=280),
        ],
    )

    layout = _detect_layout([header], None)

    assert {"bookingDate", "amount", "balance", "description"} <= set(layout.bands)
    assert layout.bands["description"].x0 == 180
    assert layout.bands["description"].x1 == 320


def test_english_statement_detects_layout_and_signed_amounts() -> None:
    result = parse_pdf(
        fixture("english-statement.pdf"),
        "english-statement.pdf",
        MEDIA_TYPE,
        ParserSettings(),
    )
    assert result.mapping.status == "confident"
    assert result.contractVersion == "racio.parser.v2"
    assert result.source.sourceType == "pdf"
    assert [candidate.amount for candidate in result.candidates] == [
        "145.5",
        "2500",
        "32.75",
        "89.99",
        "145.5",
        "240",
        "1250",
        "15.99",
    ]
    assert [candidate.direction for candidate in result.candidates] == [
        "debit",
        "credit",
        "credit",
        "debit",
        "debit",
        "debit",
        "credit",
        "debit",
    ]
    assert result.candidates[0].bookingDate == "2026-08-01"
    assert result.candidates[0].balanceAfter == "854.5"
    assert result.candidates[0].rawDescription == ("01/08/2026 MARKETPLACE PAYMENT -145.50 854.50")
    assert result.metadata is not None
    assert result.metadata.periodStart == "2026-08-01"
    assert result.metadata is not None
    assert result.metadata.periodEnd == "2026-08-08"
    assert result.metadata.openingBalance == "1000"
    assert result.metadata.closingBalance == "4145.77"
    assert result.metadata.currency == "USD"
    assert result.metadata.institutionNameText == "Northwind Neighbourhood Bank"
    assert "•1234" in (result.metadata.maskedAccountIdentifier or "")


def test_multiline_descriptions_are_joined_into_one_candidate() -> None:
    result = parse_pdf(
        fixture("multiline-descriptions.pdf"),
        "multiline-descriptions.pdf",
        MEDIA_TYPE,
        ParserSettings(),
    )
    assert len(result.candidates) == 3
    assert result.candidates[0].description == "MARKETPLACE PAYMENT ORDER 824731 ISTANBUL"
    assert result.candidates[0].amount == "145.5"
    assert result.candidates[0].direction == "debit"


def test_debit_credit_columns_preserve_direction() -> None:
    result = parse_pdf(
        fixture("debit-credit-columns.pdf"),
        "debit-credit-columns.pdf",
        MEDIA_TYPE,
        ParserSettings(),
    )
    assert result.mapping.columns.amountColumnMode == "debit_credit"
    assert [candidate.direction for candidate in result.candidates] == [
        "debit",
        "credit",
        "debit",
    ]
    assert [candidate.amount for candidate in result.candidates] == [
        "145.5",
        "2500",
        "89.99",
    ]
    assert result.candidates[2].balanceAfter == "3264.51"


def test_signed_amounts_and_direction_markers_are_honored() -> None:
    signed = parse_pdf(
        fixture("signed-amount.pdf"),
        "signed-amount.pdf",
        MEDIA_TYPE,
        ParserSettings(),
    )
    assert signed.mapping.columns.amountColumnMode == "signed"
    assert signed.candidates[0].amount == "45.5"
    assert signed.candidates[0].direction == "debit"
    assert signed.candidates[1].amount == "120"
    assert signed.candidates[1].direction == "credit"

    marked = parse_pdf(
        fixture("direction-marker.pdf"),
        "direction-marker.pdf",
        MEDIA_TYPE,
        ParserSettings(),
    )
    assert marked.candidates[0].amount == "45.5"
    assert marked.candidates[0].direction == "debit"
    assert marked.candidates[0].rawPayload["directionMarker"] == "debit"
    assert marked.candidates[1].direction == "credit"


def test_turkish_decimal_comma_and_labels() -> None:
    result = parse_pdf(
        fixture("turkish-statement.pdf"),
        "turkish-statement.pdf",
        MEDIA_TYPE,
        ParserSettings(),
    )
    assert result.mapping.status == "confident"
    assert result.mapping.columns.dateFormat == "%d/%m/%Y"
    assert result.metadata is not None
    assert result.metadata.currency == "TRY"
    assert result.metadata is not None
    assert result.metadata.institutionNameText == "Anadolu Bankası"
    assert result.metadata.openingBalance == "1000"
    assert [candidate.amount for candidate in result.candidates] == [
        "145.5",
        "2500",
        "89.99",
    ]
    assert [candidate.direction for candidate in result.candidates] == [
        "debit",
        "credit",
        "debit",
    ]
    assert result.candidates[0].balanceAfter == "854.5"


def test_arabic_rtl_statement_is_normalized_to_logical_text() -> None:
    result = parse_pdf(
        fixture("arabic-statement.pdf"),
        "arabic-statement.pdf",
        MEDIA_TYPE,
        ParserSettings(),
    )
    assert result.mapping.status == "confident"
    assert result.metadata is not None
    assert result.metadata.currency == "SAR"
    assert result.metadata is not None
    assert result.metadata.openingBalance == "1000"
    assert result.metadata.closingBalance == "3264.51"
    assert result.metadata.institutionNameText == "مصرف النور األهلي"
    assert [candidate.description for candidate in result.candidates] == [
        "دفعة سوق إلكتروني",
        "راتب شهري",
        "فاتورة كهرباء",
    ]
    assert [candidate.direction for candidate in result.candidates] == [
        "debit",
        "credit",
        "debit",
    ]
    assert [candidate.amount for candidate in result.candidates] == [
        "145.5",
        "2500",
        "89.99",
    ]


def test_yearless_dates_are_inferred_from_statement_period() -> None:
    result = parse_pdf(
        fixture("yearless-date.pdf"),
        "yearless-date.pdf",
        MEDIA_TYPE,
        ParserSettings(),
    )
    assert result.mapping.columns.hasYear is False
    assert [candidate.bookingDate for candidate in result.candidates] == [
        "2026-08-01",
        "2026-08-02",
    ]
    assert "year_inferred_from_statement_period" in result.candidates[0].warnings


def test_ambiguous_yearless_dates_are_flagged_without_guessing() -> None:
    result = parse_pdf(
        fixture("ambiguous-date.pdf"),
        "ambiguous-date.pdf",
        MEDIA_TYPE,
        ParserSettings(),
    )
    assert result.mapping.columns.hasYear is False
    assert result.candidates[0].bookingDate is None
    assert "ambiguous_booking_date" in result.candidates[0].warnings
    assert result.candidates[0].rawBookingDate == "12/08"


def test_malformed_amount_is_preserved_and_flagged_not_silently_fixed() -> None:
    result = parse_pdf(
        fixture("malformed-amount.pdf"),
        "malformed-amount.pdf",
        MEDIA_TYPE,
        ParserSettings(),
    )
    assert result.candidates[0].amount is None
    assert result.candidates[0].rawAmount == "12.34.56"
    assert "invalid_amount" in result.candidates[0].warnings
    assert result.candidates[1].amount == "10"
    assert result.candidates[1].direction == "debit"


def test_duplicate_rows_are_preserved_for_dedup_stage() -> None:
    result = parse_pdf(
        fixture("duplicate-rows.pdf"),
        "duplicate-rows.pdf",
        MEDIA_TYPE,
        ParserSettings(),
    )
    assert len(result.candidates) == 3
    assert result.candidates[0].rawDescription == result.candidates[1].rawDescription
    assert result.candidates[2].amount == "2500"
    assert result.candidates[2].direction == "credit"


def test_summary_and_footer_totals_are_not_treated_as_transactions() -> None:
    result = parse_pdf(
        fixture("footer-totals.pdf"),
        "footer-totals.pdf",
        MEDIA_TYPE,
        ParserSettings(),
    )
    assert len(result.candidates) == 3
    assert result.metadata is not None
    assert result.metadata.closingBalance == "3387.25"
    assert result.metadata is not None
    assert all("summary" not in candidate.warnings for candidate in result.candidates)


def test_multi_page_statement_repeats_headers_and_carries_period() -> None:
    result = parse_pdf(
        fixture("multi-page.pdf"),
        "multi-page.pdf",
        MEDIA_TYPE,
        ParserSettings(),
    )
    assert result.mapping.status == "confident"
    assert result.metadata is not None
    assert result.metadata.periodStart == "2026-08-01"
    assert result.metadata is not None
    assert result.metadata.periodEnd == "2026-08-31"
    assert len(result.candidates) >= 12
    assert all(candidate.sourcePage == 1 for candidate in result.candidates[:8])
    assert any(candidate.sourcePage == 2 for candidate in result.candidates)


def test_repeated_header_on_each_page_is_structural_and_skipped() -> None:
    result = parse_pdf(
        fixture("repeated-header.pdf"),
        "repeated-header.pdf",
        MEDIA_TYPE,
        ParserSettings(),
    )
    assert len(result.candidates) == 3
    assert [candidate.amount for candidate in result.candidates] == [
        "12.5",
        "40",
        "22.25",
    ]


def test_coordinate_layout_with_right_aligned_columns() -> None:
    result = parse_pdf(
        fixture("coordinate-layout.pdf"),
        "coordinate-layout.pdf",
        MEDIA_TYPE,
        ParserSettings(),
    )
    assert result.mapping.status == "confident"
    assert result.metadata is not None
    assert result.metadata.currency == "GBP"
    assert result.metadata is not None
    assert result.metadata.institutionNameText == "Riverside Co-op Bank"
    assert result.metadata.openingBalance == "1000"
    assert result.metadata.closingBalance == "3216.5"
    assert [candidate.amount for candidate in result.candidates] == [
        "24.6",
        "2300",
        "58.9",
    ]
    assert [candidate.direction for candidate in result.candidates] == [
        "debit",
        "credit",
        "debit",
    ]
    assert [candidate.balanceAfter for candidate in result.candidates] == [
        "975.4",
        "3275.4",
        "3216.5",
    ]


def test_statement_metadata_detection() -> None:
    result = parse_pdf(
        fixture("statement-metadata.pdf"),
        "statement-metadata.pdf",
        MEDIA_TYPE,
        ParserSettings(),
    )
    assert result.metadata is not None
    assert result.metadata.periodStart == "2026-08-01"
    assert result.metadata is not None
    assert result.metadata.periodEnd == "2026-08-02"
    assert result.metadata.openingBalance == "1000"
    assert result.metadata.closingBalance == "3354.5"
    assert result.metadata.currency == "USD"
    assert "•1234" in (result.metadata.maskedAccountIdentifier or "")


def test_inspection_reports_encryption_and_limits_without_side_effects() -> None:
    inspection = inspect_pdf(
        fixture("english-statement.pdf"),
        ParserSettings(),
    )
    assert inspection.contractVersion == "racio.pdf-inspection.v1"
    assert inspection.hasUsableText is True
    assert inspection.pageCount == 1
    assert inspection.sourceType == "pdf"
    assert inspection.documentWarnings == []


@pytest.mark.parametrize(
    ("name", "code"),
    [
        ("encrypted.pdf", "PDF_PASSWORD_REQUIRED"),
        ("embedded-file.pdf", "PDF_EMBEDDED_FILE_UNSUPPORTED"),
        ("malformed.pdf", "PDF_MALFORMED"),
        ("fake-binary.pdf", "PDF_INVALID"),
        ("excessive-text.pdf", "PDF_CONTENT_LIMIT"),
    ],
)
def test_pdf_security_rejections(name: str, code: str) -> None:
    with pytest.raises(PdfSecurityError, match=code):
        inspect_pdf(fixture(name), ParserSettings())
    with pytest.raises(PdfSecurityError, match=code):
        parse_pdf(fixture(name), name, MEDIA_TYPE, ParserSettings())


def test_image_only_pdf_is_reported_and_rejected_at_parse() -> None:
    inspection = inspect_pdf(fixture("image-only.pdf"), ParserSettings())
    assert inspection.hasUsableText is False
    assert inspection.likelyImageOnly is True
    assert inspection.textUsability == "image_only"
    with pytest.raises(PdfSecurityError, match="PDF_NO_USABLE_TEXT"):
        parse_pdf(fixture("image-only.pdf"), "image-only.pdf", MEDIA_TYPE, ParserSettings())


def test_configurable_page_limit_rejects_without_partial_results() -> None:
    settings = ParserSettings(max_pdf_pages=1)
    with pytest.raises(PdfSecurityError, match="PDF_TOO_MANY_PAGES"):
        inspect_pdf(fixture("excessive-pages.pdf"), settings)


def test_configurable_upload_size_limit_rejects() -> None:
    settings = ParserSettings(max_pdf_upload_bytes=1024)
    with pytest.raises(PdfSecurityError, match="PDF_TOO_LARGE"):
        inspect_pdf(fixture("english-statement.pdf"), settings)


def test_money_uses_decimal_strings_not_floating_point_arithmetic() -> None:
    source = (
        Path(__file__).resolve().parents[1] / "src" / "racio_parser" / "pdf_parser.py"
    ).read_text()
    assert "from .csv_parser import" in source
    assert "_decimal(" in source


def test_pdf_inspect_and_parse_endpoints_accept_uploads() -> None:
    payload = fixture("english-statement.pdf")
    inspection = client.post(
        "/inspect/pdf",
        files={"file": ("english.pdf", payload, MEDIA_TYPE)},
    )
    assert inspection.status_code == 200
    body = inspection.json()
    assert body["contractVersion"] == "racio.pdf-inspection.v1"
    assert body["hasUsableText"] is True

    parsed = client.post(
        "/parse/pdf",
        files={"file": ("english.pdf", payload, MEDIA_TYPE)},
    )
    assert parsed.status_code == 200
    result = parsed.json()
    assert result["contractVersion"] == "racio.parser.v2"
    assert result["mapping"]["status"] == "confident"
    assert len(result["candidates"]) == 8


def test_pdf_endpoint_rejects_malformed_payload_with_error_code() -> None:
    response = client.post(
        "/parse/pdf",
        files={"file": ("bad.pdf", b"PK\x03\x04 not a pdf", "application/pdf")},
    )
    assert response.status_code == 422
    assert response.json()["detail"] == "PDF_INVALID"
