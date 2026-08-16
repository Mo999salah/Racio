import json
import logging
import sys

from fastapi import FastAPI, File, Form, HTTPException, UploadFile

from .config import ParserSettings
from .csv_parser import parse_csv
from .models import ParserResult, ParserSource, PlaceholderParseRequest
from .pdf_parser import inspect_pdf, parse_pdf
from .pdf_security import PdfSecurityError
from .xlsx_parser import inspect_xlsx, parse_xlsx
from .xlsx_security import XlsxSecurityError

logging.basicConfig(
    level=logging.INFO,
    format='{"level":"%(levelname)s","event":"%(message)s"}',
    stream=sys.stdout,
)
logger = logging.getLogger("racio.parser")

app = FastAPI(title="Racio Parser", version="0.1.0")
settings = ParserSettings.from_environment()


@app.get("/health")
def health() -> dict[str, str]:
    return {
        "status": "ok",
        "service": "parser",
        "version": settings.version,
        "contractVersion": "racio.parser.v1",
    }


@app.post("/parse/placeholder", response_model=ParserResult)
def placeholder_parse(request: PlaceholderParseRequest) -> ParserResult:
    # Phase 1 intentionally does not inspect files. Do not log filename or file contents.
    logger.info("placeholder_parse_requested")
    return ParserResult(
        contractVersion="racio.parser.v1",
        source=ParserSource(filename=request.filename, mediaType=request.mediaType),
        candidates=[],
        warnings=["Real statement parsing is deferred to the import phase."],
    )


@app.post("/parse/csv")
async def csv_parse(
    file: UploadFile = File(...),  # noqa: B008
    mapping: str | None = Form(default=None),
) -> dict[str, object]:
    if not file.filename or not file.filename.lower().endswith(".csv"):
        raise HTTPException(status_code=415, detail="csv_only")
    content = await file.read(20 * 1024 * 1024 + 1)
    if len(content) > 20 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="file_limit_exceeded")
    try:
        override = json.loads(mapping) if mapping else None
        result = parse_csv(content, file.filename, file.content_type or "text/csv", override)
    except (ValueError, json.JSONDecodeError) as error:
        logger.info("csv_parse_rejected", extra={"reason": str(error)})
        raise HTTPException(status_code=422, detail="csv_parse_failed") from error
    return result.model_dump()


async def _read_xlsx(file: UploadFile) -> bytes:
    if not file.filename or not file.filename.lower().endswith(".xlsx"):
        raise HTTPException(status_code=415, detail="XLSX_INVALID_WORKBOOK")
    content = await file.read(settings.max_xlsx_archive_bytes + 1)
    if len(content) > settings.max_xlsx_archive_bytes:
        raise HTTPException(status_code=413, detail="XLSX_ARCHIVE_LIMIT_EXCEEDED")
    return content


@app.post("/inspect/xlsx")
async def xlsx_inspect(file: UploadFile = File(...)) -> dict[str, object]:  # noqa: B008
    content = await _read_xlsx(file)
    try:
        result = inspect_xlsx(content, file.filename or "statement.xlsx", settings)
    except XlsxSecurityError as error:
        logger.info("xlsx_inspection_rejected", extra={"reason": error.code})
        raise HTTPException(status_code=422, detail=error.code) from error
    return result.model_dump()


@app.post("/parse/xlsx")
async def xlsx_parse(
    file: UploadFile = File(...),  # noqa: B008
    sheet_index: int = Form(...),
    mapping: str | None = Form(default=None),
) -> dict[str, object]:
    content = await _read_xlsx(file)
    try:
        override = json.loads(mapping) if mapping else None
        result = parse_xlsx(
            content,
            file.filename or "statement.xlsx",
            file.content_type
            or "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            sheet_index,
            settings,
            override,
        )
    except (XlsxSecurityError, json.JSONDecodeError, ValueError) as error:
        code = error.code if isinstance(error, XlsxSecurityError) else "XLSX_PARSE_FAILED"
        logger.info("xlsx_parse_rejected", extra={"reason": code})
        raise HTTPException(status_code=422, detail=code) from error
    return result.model_dump()


async def _read_pdf(file: UploadFile) -> bytes:
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=415, detail="PDF_INVALID")
    content = await file.read(settings.max_pdf_upload_bytes + 1)
    if len(content) > settings.max_pdf_upload_bytes:
        raise HTTPException(status_code=413, detail="PDF_TOO_LARGE")
    return content


def _pdf_error(error: PdfSecurityError) -> HTTPException:
    logger.info("pdf_rejected", extra={"reason": error.code})
    return HTTPException(status_code=422, detail=error.code)


@app.post("/inspect/pdf")
async def pdf_inspect(file: UploadFile = File(...)) -> dict[str, object]:  # noqa: B008
    content = await _read_pdf(file)
    try:
        result = inspect_pdf(content, settings)
    except PdfSecurityError as error:
        raise _pdf_error(error) from error
    return result.model_dump()


@app.post("/parse/pdf")
async def pdf_parse(
    file: UploadFile = File(...),  # noqa: B008
    mapping: str | None = Form(default=None),
) -> dict[str, object]:
    content = await _read_pdf(file)
    try:
        override = json.loads(mapping) if mapping else None
        result = parse_pdf(
            content,
            file.filename or "statement.pdf",
            file.content_type or "application/pdf",
            settings,
            override,
        )
    except (PdfSecurityError, json.JSONDecodeError, ValueError) as error:
        if isinstance(error, PdfSecurityError):
            raise _pdf_error(error) from error
        logger.info("pdf_parse_rejected", extra={"reason": "PDF_PARSE_FAILED"})
        raise HTTPException(status_code=422, detail="PDF_PARSE_FAILED") from error
    return result.model_dump()
