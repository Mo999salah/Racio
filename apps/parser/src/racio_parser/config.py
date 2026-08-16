import os
from typing import Literal, cast

from pydantic import BaseModel, Field


class ParserSettings(BaseModel):
    environment: Literal["development", "test", "production"] = "development"
    version: str = "0.0.0-dev"
    max_xlsx_archive_bytes: int = Field(default=20 * 1024 * 1024, gt=0)
    max_xlsx_uncompressed_bytes: int = Field(default=100 * 1024 * 1024, gt=0)
    max_xlsx_compression_ratio: float = Field(default=100.0, gt=0)
    max_xlsx_zip_entries: int = Field(default=2_048, gt=0)
    max_xlsx_sheets: int = Field(default=32, gt=0)
    max_xlsx_rows: int = Field(default=100_000, gt=0)
    max_xlsx_columns: int = Field(default=256, gt=0)
    max_xlsx_populated_cells: int = Field(default=500_000, gt=0)
    max_xlsx_shared_strings: int = Field(default=250_000, gt=0)
    max_xlsx_cell_string_length: int = Field(default=20_000, gt=0)
    max_xlsx_formulas: int = Field(default=10_000, ge=0)
    max_xlsx_merged_ranges: int = Field(default=2_000, ge=0)
    max_pdf_upload_bytes: int = Field(default=20 * 1024 * 1024, gt=0)
    max_pdf_pages: int = Field(default=200, gt=0)
    max_pdf_page_dimension_points: float = Field(default=14_400.0, gt=0)
    max_pdf_chars_per_page: int = Field(default=200_000, gt=0)
    max_pdf_total_chars: int = Field(default=2_000_000, gt=0)
    max_pdf_words_per_page: int = Field(default=40_000, gt=0)
    max_pdf_candidates: int = Field(default=50_000, gt=0)
    max_pdf_stream_bytes: int = Field(default=40 * 1024 * 1024, gt=0)
    max_pdf_objects: int = Field(default=100_000, gt=0)

    @classmethod
    def from_environment(cls) -> "ParserSettings":
        def integer(name: str, default: int) -> int:
            return int(os.getenv(name, str(default)))

        environment = os.getenv("PARSER_ENV", "development")
        if environment not in {"development", "test", "production"}:
            raise ValueError("invalid_parser_environment")
        return cls(
            environment=cast(Literal["development", "test", "production"], environment),
            version=os.getenv("RACIO_VERSION", "0.0.0-dev"),
            max_xlsx_archive_bytes=integer("MAX_XLSX_ARCHIVE_BYTES", 20 * 1024 * 1024),
            max_xlsx_uncompressed_bytes=integer("MAX_XLSX_UNCOMPRESSED_BYTES", 100 * 1024 * 1024),
            max_xlsx_compression_ratio=float(os.getenv("MAX_XLSX_COMPRESSION_RATIO", "100")),
            max_xlsx_zip_entries=integer("MAX_XLSX_ZIP_ENTRIES", 2_048),
            max_xlsx_sheets=integer("MAX_XLSX_SHEETS", 32),
            max_xlsx_rows=integer("MAX_XLSX_ROWS", 100_000),
            max_xlsx_columns=integer("MAX_XLSX_COLUMNS", 256),
            max_xlsx_populated_cells=integer("MAX_XLSX_POPULATED_CELLS", 500_000),
            max_xlsx_shared_strings=integer("MAX_XLSX_SHARED_STRINGS", 250_000),
            max_xlsx_cell_string_length=integer("MAX_XLSX_CELL_STRING_LENGTH", 20_000),
            max_xlsx_formulas=integer("MAX_XLSX_FORMULAS", 10_000),
            max_xlsx_merged_ranges=integer("MAX_XLSX_MERGED_RANGES", 2_000),
            max_pdf_upload_bytes=integer("MAX_PDF_UPLOAD_BYTES", 20 * 1024 * 1024),
            max_pdf_pages=integer("MAX_PDF_PAGES", 200),
            max_pdf_page_dimension_points=float(
                os.getenv("MAX_PDF_PAGE_DIMENSION_POINTS", "14400")
            ),
            max_pdf_chars_per_page=integer("MAX_PDF_CHARS_PER_PAGE", 200_000),
            max_pdf_total_chars=integer("MAX_PDF_TOTAL_CHARS", 2_000_000),
            max_pdf_words_per_page=integer("MAX_PDF_WORDS_PER_PAGE", 40_000),
            max_pdf_candidates=integer("MAX_PDF_CANDIDATES", 50_000),
            max_pdf_stream_bytes=integer("MAX_PDF_STREAM_BYTES", 40 * 1024 * 1024),
            max_pdf_objects=integer("MAX_PDF_OBJECTS", 100_000),
        )
