from fastapi.testclient import TestClient

from racio_parser.config import ParserSettings
from racio_parser.csv_parser import parse_csv
from racio_parser.main import app

client = TestClient(app)


def test_settings_are_typed_and_reject_unknown_environment() -> None:
    assert ParserSettings(environment="test").environment == "test"


def test_health() -> None:
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["service"] == "parser"


def test_placeholder_returns_typed_empty_result() -> None:
    response = client.post(
        "/parse/placeholder",
        json={"filename": "statement.csv", "mediaType": "text/csv"},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["contractVersion"] == "racio.parser.v1"
    assert body["candidates"] == []


def test_csv_parser_detects_comma_and_signed_amounts() -> None:
    result = parse_csv(
        b"Date,Description,Amount,Currency\n2026-01-01,Coffee,-4.50,USD\n",
        "statement.csv",
        "text/csv",
    )
    assert result.mapping.status == "confident"
    assert result.source.delimiter == ","
    assert result.candidates[0].amount == "4.5"
    assert result.candidates[0].direction == "debit"


def test_csv_parser_supports_semicolon_decimal_comma_and_quotes() -> None:
    result = parse_csv(
        'Tarih;Açıklama;Tutar;Para Birimi\n02.01.2026;"Market; merkez";-45,90;TRY\n'.encode(),
        "ekstre.csv",
        "text/csv",
    )
    assert result.source.delimiter == ";"
    assert result.candidates[0].rawDescription == "Market; merkez"
    assert result.candidates[0].amount == "45.9"
    assert result.candidates[0].direction == "debit"


def test_csv_parser_preserves_scale_zero_through_six_without_float_conversion() -> None:
    result = parse_csv(
        b"Date,Description,Amount,Currency\n"
        b"2026-01-01,Zero,0.00,USD\n"
        b"2026-01-02,Two,12.34,USD\n"
        b"2026-01-03,Three,12.345,USD\n"
        b"2026-01-04,Six,0.123456,USD\n"
        b"2026-01-05,TooPrecise,0.1234567,USD\n",
        "precision.csv",
        "text/csv",
    )
    assert [candidate.amount for candidate in result.candidates] == [
        "0",
        "12.34",
        "12.345",
        "0.123456",
        None,
    ]
    assert result.candidates[3].rawAmount == "0.123456"
    assert result.candidates[4].rawAmount == "0.1234567"
    assert "invalid_amount" in result.candidates[4].warnings


def test_csv_parser_rejects_null_bytes() -> None:
    try:
        parse_csv(b"Date,Description\n2026-01-01,\x00\n", "bad.csv", "text/csv")
    except ValueError as error:
        assert str(error) == "null_byte"
    else:
        raise AssertionError("null bytes must be rejected")
