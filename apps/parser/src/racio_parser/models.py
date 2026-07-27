from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

DecimalString = Annotated[str, StringConstraints(pattern=r"^-?\d{1,14}(?:\.\d{1,6})?$")]
CurrencyCode = Annotated[str, StringConstraints(pattern=r"^[A-Z]{3}$")]


class Confidence(BaseModel):
    model_config = ConfigDict(extra="forbid")

    overall: float = Field(ge=0, le=1)
    fields: dict[str, float] | None = None


class ParsedTransactionCandidate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    sourceRow: int | None = Field(default=None, gt=0)
    sourcePage: int | None = Field(default=None, gt=0)
    bookingDate: str | None = None
    valueDate: str | None = None
    rawDescription: str = Field(min_length=1)
    normalizedDescription: str | None = Field(default=None, min_length=1)
    amount: DecimalString | None = None
    currency: CurrencyCode | None = None
    direction: Literal["credit", "debit", "unknown"] | None = None
    balanceAfter: DecimalString | None = None
    counterparty: str | None = Field(default=None, min_length=1)
    confidence: Confidence
    warnings: list[str]


class ParserSource(BaseModel):
    model_config = ConfigDict(extra="forbid")

    filename: str = Field(min_length=1)
    mediaType: str = Field(min_length=1)


class ParserResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    contractVersion: Literal["racio.parser.v1"]
    source: ParserSource
    candidates: list[ParsedTransactionCandidate]
    warnings: list[str]


class PlaceholderParseRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    filename: str = Field(min_length=1)
    mediaType: str = Field(min_length=1)


class CsvMapping(BaseModel):
    model_config = ConfigDict(extra="forbid")

    headerRow: int = Field(ge=0)
    bookingDate: int | None = Field(default=None, ge=0)
    valueDate: int | None = Field(default=None, ge=0)
    description: int | None = Field(default=None, ge=0)
    amount: int | None = Field(default=None, ge=0)
    debit: int | None = Field(default=None, ge=0)
    credit: int | None = Field(default=None, ge=0)
    currency: int | None = Field(default=None, ge=0)
    balance: int | None = Field(default=None, ge=0)
    counterparty: int | None = Field(default=None, ge=0)
    transactionIdentifier: int | None = Field(default=None, ge=0)
    decimalSeparator: Literal[".", ","] | None = None
    thousandsSeparator: Literal[".", ",", " "] | None = None
    dateFormat: str | None = Field(default=None, max_length=40)


class CsvParsedCandidate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    sourceRow: int = Field(gt=0)
    rawPayload: dict[str, str]
    rawDescription: str
    rawBookingDate: str | None
    rawValueDate: str | None
    rawAmount: str | None
    rawCurrency: str | None
    rawBalance: str | None
    bookingDate: str | None
    valueDate: str | None
    amount: Annotated[str, StringConstraints(pattern=r"^\d{1,14}(?:\.\d{1,6})?$")] | None
    currency: CurrencyCode | None
    direction: Literal["credit", "debit", "unknown"]
    balanceAfter: DecimalString | None
    counterparty: str | None
    bankTransactionId: str | None
    confidence: float = Field(ge=0, le=1)
    fieldConfidence: dict[str, float]
    warnings: list[str]


class CsvParserSource(BaseModel):
    model_config = ConfigDict(extra="forbid")

    filename: str = Field(min_length=1)
    mediaType: str = Field(min_length=1)
    encoding: str = Field(min_length=1)
    delimiter: str = Field(min_length=1, max_length=1)
    quoteChar: str = Field(min_length=1, max_length=1)
    headerRow: int = Field(ge=0)
    detectedLanguage: str | None
    decimalSeparator: Literal[".", ","] | None
    thousandsSeparator: Literal[".", ",", " "] | None
    dateFormat: str | None


class CsvMappingResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: Literal["confident", "ambiguous", "invalid"]
    columns: CsvMapping
    confidence: float = Field(ge=0, le=1)
    warnings: list[str]


class CsvParserResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    contractVersion: Literal["racio.parser.v2"]
    source: CsvParserSource
    mapping: CsvMappingResult
    candidates: list[CsvParsedCandidate]
    warnings: list[str]
