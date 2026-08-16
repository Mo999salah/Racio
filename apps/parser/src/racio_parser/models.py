from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

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


class WorkbookSheetInspection(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(min_length=1, max_length=200)
    name: str = Field(min_length=1, max_length=500)
    index: int = Field(ge=0)
    hidden: bool
    veryHidden: bool
    estimatedRows: int = Field(ge=0)
    estimatedColumns: int = Field(ge=0)
    populatedCells: int = Field(ge=0)
    mergedRangeCount: int = Field(ge=0)
    formulaCellCount: int = Field(ge=0)
    sampleRows: list[list[Annotated[str, StringConstraints(max_length=2_000)]]]
    warnings: list[str]


class WorkbookInspection(BaseModel):
    model_config = ConfigDict(extra="forbid")

    contractVersion: Literal["racio.workbook-inspection.v1"]
    workbookType: Literal["xlsx"]
    sheetCount: int = Field(ge=0)
    dateSystem: Literal["1900", "1904"]
    sheets: list[WorkbookSheetInspection]
    workbookWarnings: list[str]


class XlsxMapping(CsvMapping):
    model_config = ConfigDict(extra="forbid")

    sourceType: Literal["xlsx"]
    selectedSheetId: str = Field(min_length=1, max_length=200)
    selectedSheetName: str = Field(min_length=1, max_length=500)
    selectedSheetIndex: int = Field(ge=0)
    headerRow: int = Field(gt=0)
    firstDataRow: int = Field(gt=0)
    lastDataRow: int | None = Field(default=None, gt=0)
    columnLetters: dict[str, str] | None = None
    cellTypeHints: dict[str, str] | None = None
    numberFormatHints: dict[str, str] | None = None

    @model_validator(mode="after")
    def validate_data_range(self) -> "XlsxMapping":
        if self.firstDataRow <= self.headerRow:
            raise ValueError("first_data_row_must_follow_header")
        if self.lastDataRow is not None and self.lastDataRow < self.firstDataRow:
            raise ValueError("last_data_row_before_first")
        return self


class RawWorkbookCell(BaseModel):
    model_config = ConfigDict(extra="forbid")

    row: int = Field(gt=0)
    column: int = Field(gt=0)
    coordinate: str
    displayedText: str | None = Field(default=None, max_length=20_000)
    rawType: Literal[
        "blank",
        "string",
        "number",
        "date",
        "boolean",
        "formula_cached",
        "formula_uncached",
        "error",
    ]
    rawValue: str | None = Field(default=None, max_length=20_000)
    numberFormat: str | None = Field(default=None, max_length=500)
    formula: str | None = Field(default=None, max_length=2_000)
    hasCachedValue: bool | None = None


class XlsxParsedCandidate(CsvParsedCandidate):
    model_config = ConfigDict(extra="forbid")

    rawCells: list[RawWorkbookCell]


class XlsxParserSource(BaseModel):
    model_config = ConfigDict(extra="forbid")

    sourceType: Literal["xlsx"]
    filename: str = Field(min_length=1)
    mediaType: str = Field(min_length=1)
    sheetName: str = Field(min_length=1, max_length=500)
    sheetIndex: int = Field(ge=0)
    headerRow: int = Field(gt=0)
    firstDataRow: int = Field(gt=0)
    lastDataRow: int | None = Field(default=None, gt=0)
    workbookDateSystem: Literal["1900", "1904"]
    formulaCellCount: int = Field(ge=0)
    mergedRangeCount: int = Field(ge=0)
    detectedLanguage: str | None


class XlsxMappingResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: Literal["confident", "ambiguous", "invalid"]
    columns: XlsxMapping
    confidence: float = Field(ge=0, le=1)
    warnings: list[str]


class XlsxParserResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    contractVersion: Literal["racio.parser.v2"]
    source: XlsxParserSource
    mapping: XlsxMappingResult
    candidates: list[XlsxParsedCandidate]
    warnings: list[str]


class PdfPageInspection(BaseModel):
    model_config = ConfigDict(extra="forbid")

    pageNumber: int = Field(gt=0)
    width: float = Field(ge=0)
    height: float = Field(ge=0)
    textCharacterCount: int = Field(ge=0)
    wordCount: int = Field(ge=0)
    imageCount: int = Field(ge=0)
    likelyTable: bool
    sampleLines: list[Annotated[str, StringConstraints(max_length=2_000)]]
    warnings: list[str]


class PdfInspection(BaseModel):
    model_config = ConfigDict(extra="forbid")

    contractVersion: Literal["racio.pdf-inspection.v1"]
    sourceType: Literal["pdf"]
    pageCount: int = Field(ge=0)
    encrypted: bool
    hasUsableText: bool
    likelyImageOnly: bool
    textUsability: Literal["usable", "mixed", "image_only", "none"]
    textCharacterCount: int = Field(ge=0)
    pages: list[PdfPageInspection]
    documentWarnings: list[str]


class PdfBoundingBox(BaseModel):
    model_config = ConfigDict(extra="forbid")

    x0: float
    top: float
    x1: float
    bottom: float


class PdfStatementMetadata(BaseModel):
    model_config = ConfigDict(extra="forbid")

    periodStart: str | None
    periodEnd: str | None
    openingBalance: DecimalString | None
    closingBalance: DecimalString | None
    currency: CurrencyCode | None
    institutionNameText: str | None = Field(default=None, max_length=200)
    maskedAccountIdentifier: str | None = Field(default=None, max_length=80)


class PdfColumnBand(BaseModel):
    model_config = ConfigDict(extra="forbid")

    label: str = Field(min_length=1, max_length=200)
    x0: float = Field(ge=0)
    x1: float = Field(ge=0)


class PdfMapping(BaseModel):
    model_config = ConfigDict(extra="forbid")

    sourceType: Literal["pdf"]
    pageCount: int = Field(ge=0)
    sourcePages: list[int]
    headerLabels: list[str]
    columnBands: list[PdfColumnBand]
    amountColumnMode: Literal["signed", "debit_credit", "unknown"]
    lineGroupingStrategy: str = Field(min_length=1, max_length=100)
    hasYear: bool
    decimalSeparator: Literal[".", ","] | None = None
    thousandsSeparator: Literal[".", ",", " "] | None = None
    dateFormat: str | None = Field(default=None, max_length=40)


class PdfMappingResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: Literal["confident", "ambiguous", "invalid"]
    columns: PdfMapping
    confidence: float = Field(ge=0, le=1)
    warnings: list[str]


class PdfParsedCandidate(CsvParsedCandidate):
    model_config = ConfigDict(extra="forbid")

    sourcePage: int = Field(gt=0)
    description: Annotated[str, StringConstraints(max_length=1_000)] | None = None
    rawLines: list[Annotated[str, StringConstraints(max_length=2_000)]]
    boundingBox: PdfBoundingBox | None = None
    parserStrategy: str | None = Field(default=None, max_length=100)


class PdfParserSource(BaseModel):
    model_config = ConfigDict(extra="forbid")

    sourceType: Literal["pdf"]
    filename: str = Field(min_length=1)
    mediaType: str = Field(min_length=1)
    pageCount: int = Field(ge=0)
    detectedLanguage: str | None
    amountColumnMode: Literal["signed", "debit_credit", "unknown"]
    hasYear: bool
    decimalSeparator: Literal[".", ","] | None = None
    thousandsSeparator: Literal[".", ",", " "] | None = None
    dateFormat: str | None = Field(default=None, max_length=40)


class PdfParserResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    contractVersion: Literal["racio.parser.v2"]
    source: PdfParserSource
    mapping: PdfMappingResult
    candidates: list[PdfParsedCandidate]
    metadata: PdfStatementMetadata | None = None
    warnings: list[str]
