# Racio parser service

The parser is an isolated FastAPI service. It exposes `/health`,
`/parse/placeholder`, `/parse/csv`, `/inspect/xlsx`, and `/parse/xlsx`. It has
no database, OAuth, AI, or storage credentials and returns neutral versioned
typed results only.

Run locally with:

```text
uv sync --dev
uv run uvicorn racio_parser.main:app --reload --port 8001
```

CSV bounds file, line, field, and row sizes. XLSX inspection validates the
ZIP/XML container, relationships, expanded size and ratio, sheet/cell
dimensions, formulas, merged ranges, strings, active content, and
encrypted/binary formats before loading the workbook model. Money is transported
as decimal strings, formulas are never evaluated, and workbook/cell content is
never written to logs. See `docs/xlsx-import.md` for the full contract.
