# Racio parser service

The parser is an isolated FastAPI service. It currently exposes `/health` and
`/parse/placeholder`; it does not parse statements yet and has no database or
AI access.

Run locally with:

```text
uv sync --dev
uv run uvicorn racio_parser.main:app --reload --port 8001
```

Future adapters must enforce file-size, page-count, decompression, row-count,
memory, and execution-time limits before processing untrusted documents. The
service returns neutral typed results with decimal-string amounts and must not
write document content or financial data to logs.
