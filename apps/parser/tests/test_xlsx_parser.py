from pathlib import Path

import pytest

from racio_parser.config import ParserSettings
from racio_parser.xlsx_parser import inspect_xlsx, parse_xlsx
from racio_parser.xlsx_security import XlsxSecurityError, validate_xlsx_archive

FIXTURES = Path(__file__).resolve().parents[3] / "fixtures" / "statements" / "xlsx"
MEDIA_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def fixture(name: str) -> bytes:
    return (FIXTURES / name).read_bytes()


def test_inspection_lists_visible_hidden_and_very_hidden_sheets() -> None:
    result = inspect_xlsx(
        fixture("multiple-visible-and-hidden.xlsx"),
        "multiple-visible-and-hidden.xlsx",
        ParserSettings(),
    )
    assert result.sheetCount == 4
    assert [sheet.name for sheet in result.sheets] == [
        "January",
        "February",
        "Archive",
        "Internal",
    ]
    assert result.sheets[2].hidden is True
    assert result.sheets[2].veryHidden is False
    assert result.sheets[3].veryHidden is True
    assert len(result.sheets[0].sampleRows) <= 8
    assert all(len(row) <= 16 for row in result.sheets[0].sampleRows)


def test_xlsx_parser_detects_header_and_preserves_decimal_strings() -> None:
    result = parse_xlsx(
        fixture("english-one-sheet.xlsx"),
        "english-one-sheet.xlsx",
        MEDIA_TYPE,
        0,
        ParserSettings(),
    )
    assert result.mapping.status == "confident"
    assert result.mapping.columns.headerRow == 1
    assert result.mapping.columns.firstDataRow == 2
    assert result.candidates[0].amount == "12.34"
    assert result.candidates[0].direction == "debit"
    assert result.candidates[0].balanceAfter == "987.66"
    assert result.candidates[0].rawCells[2].coordinate == "C2"
    assert result.candidates[0].rawCells[2].rawValue == "-12.34"


def test_title_merged_cells_repeated_header_and_footer_are_deterministic() -> None:
    result = parse_xlsx(
        fixture("title-merged-repeated-footer.xlsx"),
        "title-merged-repeated-footer.xlsx",
        MEDIA_TYPE,
        0,
        ParserSettings(),
    )
    assert result.mapping.columns.headerRow == 3
    assert "repeated_header_row" in result.warnings
    assert "footer_or_summary_rows_present" in result.warnings
    assert result.candidates[-1].warnings == [
        "invalid_amount",
        "unknown_direction",
        "possible_summary_row",
    ]


def test_turkish_numeric_cells_and_arabic_debit_credit_columns() -> None:
    turkish = parse_xlsx(
        fixture("turkish-decimal-comma.xlsx"),
        "turkish-decimal-comma.xlsx",
        MEDIA_TYPE,
        0,
        ParserSettings(),
    )
    assert turkish.candidates[0].amount == "45.9"
    assert turkish.candidates[0].currency == "TRY"

    arabic = parse_xlsx(
        fixture("arabic-debit-credit.xlsx"),
        "arabic-debit-credit.xlsx",
        MEDIA_TYPE,
        0,
        ParserSettings(),
    )
    assert arabic.mapping.columns.debit == 2
    assert arabic.mapping.columns.credit == 3
    assert [candidate.amount for candidate in arabic.candidates] == ["25.5", "100"]
    assert [candidate.direction for candidate in arabic.candidates] == ["debit", "credit"]


def test_text_amount_precision_and_ambiguous_text_date_require_review() -> None:
    result = parse_xlsx(
        fixture("dates-text-amounts-multiple-currencies.xlsx"),
        "dates-text-amounts-multiple-currencies.xlsx",
        MEDIA_TYPE,
        0,
        ParserSettings(),
    )
    assert [candidate.amount for candidate in result.candidates[:4]] == [
        "12.34",
        "12.345",
        "0.123456",
        None,
    ]
    assert result.candidates[3].rawAmount == "0.1234567"
    assert "invalid_amount" in result.candidates[3].warnings
    assert result.candidates[2].bookingDate is None
    assert "ambiguous_booking_date" in result.candidates[2].warnings
    assert result.candidates[4].amount == "5"


def test_binary_floating_point_artifact_uses_display_precision_conservatively() -> None:
    result = parse_xlsx(
        fixture("floating-point-artifact.xlsx"),
        "floating-point-artifact.xlsx",
        MEDIA_TYPE,
        0,
        ParserSettings(),
    )
    assert result.candidates[0].amount == "12.34"
    assert "precision_normalized_from_display_format" in result.candidates[0].warnings
    assert result.candidates[0].rawAmount == "-12.340000000000002"


def test_1904_date_system_is_preserved_without_timezone_shift() -> None:
    result = parse_xlsx(
        fixture("date-system-1904.xlsx"),
        "date-system-1904.xlsx",
        MEDIA_TYPE,
        0,
        ParserSettings(),
    )
    assert result.source.workbookDateSystem == "1904"
    assert result.candidates[0].bookingDate == "2026-05-01"


def test_1900_date_system_and_user_selected_row_range_are_preserved() -> None:
    detected = parse_xlsx(
        fixture("title-merged-repeated-footer.xlsx"),
        "title-merged-repeated-footer.xlsx",
        MEDIA_TYPE,
        0,
        ParserSettings(),
    )
    mapping = detected.mapping.columns.model_dump()
    mapping.update({"headerRow": 3, "firstDataRow": 4, "lastDataRow": 6})
    selected = parse_xlsx(
        fixture("title-merged-repeated-footer.xlsx"),
        "title-merged-repeated-footer.xlsx",
        MEDIA_TYPE,
        0,
        ParserSettings(),
        mapping,
    )
    assert selected.source.workbookDateSystem == "1900"
    assert [candidate.sourceRow for candidate in selected.candidates] == [4, 6]
    assert selected.mapping.columns.lastDataRow == 6


def test_formulas_never_execute_and_require_a_cached_value() -> None:
    uncached = parse_xlsx(
        fixture("formula-without-cache.xlsx"),
        "formula-without-cache.xlsx",
        MEDIA_TYPE,
        0,
        ParserSettings(),
    )
    assert uncached.candidates[0].amount is None
    assert "formula_value_unavailable" in uncached.candidates[0].warnings
    assert uncached.candidates[0].rawCells[2].rawType == "formula_uncached"

    cached = parse_xlsx(
        fixture("formula-with-cached-value.xlsx"),
        "formula-with-cached-value.xlsx",
        MEDIA_TYPE,
        0,
        ParserSettings(),
    )
    assert cached.candidates[0].amount == "12.34"
    assert "formula_cached_value" in cached.candidates[0].warnings
    assert cached.candidates[0].rawCells[2].hasCachedValue is True


@pytest.mark.parametrize(
    ("name", "code"),
    [
        ("fake-binary.xlsx", "XLSX_INVALID_WORKBOOK"),
        ("zip-traversal.xlsx", "XLSX_PATH_TRAVERSAL"),
        ("compression-bomb-simulation.xlsx", "XLSX_ARCHIVE_LIMIT_EXCEEDED"),
        ("malformed-workbook.xlsx", "XLSX_INVALID_XML"),
        ("external-link.xlsx", "XLSX_EXTERNAL_LINKS_UNSUPPORTED"),
        ("missing-relationship-target.xlsx", "XLSX_INVALID_WORKBOOK"),
        ("macro-enabled.xlsm", "XLSX_MACRO_ENABLED"),
        ("excessive-rows.xlsx", "XLSX_ROW_LIMIT_EXCEEDED"),
        ("excessive-columns.xlsx", "XLSX_COLUMN_LIMIT_EXCEEDED"),
    ],
)
def test_archive_and_workbook_security_rejections(name: str, code: str) -> None:
    with pytest.raises(XlsxSecurityError, match=code):
        inspect_xlsx(fixture(name), name, ParserSettings())


def test_configurable_archive_entry_limit_rejects_without_truncation() -> None:
    settings = ParserSettings(max_xlsx_zip_entries=1)
    with pytest.raises(XlsxSecurityError, match="XLSX_ARCHIVE_LIMIT_EXCEEDED"):
        validate_xlsx_archive(fixture("english-one-sheet.xlsx"), settings)


@pytest.mark.parametrize(
    ("name", "settings", "code"),
    [
        (
            "english-one-sheet.xlsx",
            ParserSettings(max_xlsx_populated_cells=5),
            "XLSX_CELL_LIMIT_EXCEEDED",
        ),
        (
            "english-one-sheet.xlsx",
            ParserSettings(max_xlsx_cell_string_length=5),
            "XLSX_CELL_STRING_LIMIT_EXCEEDED",
        ),
        (
            "formula-without-cache.xlsx",
            ParserSettings(max_xlsx_formulas=0),
            "XLSX_FORMULA_LIMIT_EXCEEDED",
        ),
        (
            "title-merged-repeated-footer.xlsx",
            ParserSettings(max_xlsx_merged_ranges=0),
            "XLSX_MERGED_RANGE_LIMIT_EXCEEDED",
        ),
    ],
)
def test_configurable_workbook_limits_reject_without_partial_results(
    name: str, settings: ParserSettings, code: str
) -> None:
    with pytest.raises(XlsxSecurityError, match=code):
        inspect_xlsx(fixture(name), name, settings)


def test_money_conversion_uses_raw_xml_decimal_tokens_not_float_arithmetic() -> None:
    source = (
        Path(__file__).resolve().parents[1] / "src" / "racio_parser" / "xlsx_parser.py"
    ).read_text()
    assert "Decimal(raw)" in source
    assert "float(" not in source
