import json
import logging
import sys

from fastapi import FastAPI, File, Form, HTTPException, UploadFile

from .config import ParserSettings
from .csv_parser import parse_csv
from .models import ParserResult, PlaceholderParseRequest

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
    return {"status": "ok", "service": "parser", "contractVersion": "racio.parser.v1"}


@app.post("/parse/placeholder", response_model=ParserResult)
def placeholder_parse(request: PlaceholderParseRequest) -> ParserResult:
    # Phase 1 intentionally does not inspect files. Do not log filename or file contents.
    logger.info("placeholder_parse_requested")
    return ParserResult(
        contractVersion="racio.parser.v1",
        source={"filename": request.filename, "mediaType": request.mediaType},
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
