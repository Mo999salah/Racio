# Third-party notices

Racio is distributed under its own repository license (see the repository
root). This file lists the principal third-party dependencies used in the
production runtime and their licenses, for compliance and auditability.
Development-only tooling (for example Vitest, Playwright, TypeScript, ESLint,
Prettier, Turbo, tsx, ruff, mypy, pytest) is excluded per common distribution
practice; if Racio is redistributed as a bundled artifact, re-run a full
license scan over the shipped dependency closure.

## JavaScript / TypeScript runtime

| Dependency               | Version | License    |
| ------------------------ | ------- | ---------- |
| Next.js                  | 15.5.x  | MIT        |
| React / React DOM        | 19.x    | MIT        |
| Better Auth              | 1.6.x   | MIT        |
| better-call              | 1.3.x   | MIT        |
| jose                     | 6.x     | MIT        |
| Drizzle ORM              | 0.45.x  | Apache-2.0 |
| drizzle-kit (migrations) | 0.31.x  | MIT        |
| postgres (postgres-js)   | 3.x     | Unlicense  |
| pg (driver for tooling)  | 8.x     | MIT        |
| pg-boss                  | 12.x    | MIT        |
| next-intl                | 4.x     | MIT        |
| zod                      | 3.x     | MIT        |
| TanStack React Query     | 5.x     | MIT        |
| TanStack React Table     | 8.x     | MIT        |
| react-hook-form          | 7.x     | MIT        |
| fflate                   | 0.8.x   | MIT        |

## Python runtime (parser service)

| Dependency       | Version | License          |
| ---------------- | ------- | ---------------- |
| FastAPI          | 0.140.x | MIT              |
| Uvicorn          | 0.51.x  | BSD-3-Clause     |
| Pydantic         | 2.x     | MIT              |
| pypdf            | 6.16.x  | BSD-3-Clause     |
| pdfplumber       | 0.11.x  | MIT              |
| pdfminer.six     | 2026.x  | MIT              |
| openpyxl         | 3.1.x   | MIT              |
| pandas           | 2.x     | BSD-3-Clause     |
| cryptography     | 50.x    | Apache-2.0 / BSD |
| python-multipart | 0.0.x   | Apache-2.0       |

## Licensing notes

- PyMuPDF is deliberately **not** used by the parser: its AGPL/commercial
  licensing implications would require an explicit project decision before
  adoption (see `ARCHITECTURE.md`).
- The Hallmark design skill is a development-time workflow skill and produces
  no runtime code; it is not part of any distributed artifact.
- This list is a summary. Exact license texts are available in each package's
  distribution (node_modules / the Python environment).
