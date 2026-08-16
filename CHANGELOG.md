# Racio changelog

## 0.1.0 — MVP release

### Major capabilities

- Privacy-conscious personal finance workspace with Arabic (RTL), English,
  and Turkish interfaces, easy/advanced modes, and light/dark appearance.
- Review-first statement import for text CSV, XLSX, and PDF through an
  isolated Python parser: bounded uploads, container/security inspection,
  mapping, review, duplicates, reconciliation, atomic confirmation, and
  post-import classification, merchant-alias, and transfer-suggestion work.
- Server-paginated transaction ledger with immutable imported financial
  fields, editable metadata, user-owned categories/tags, notes, saved views,
  and deterministic classification rules with previews and history.
- Exact transaction splits, user-owned merchants and aliases, and explicitly
  confirmed internal transfers excluded from financial cash flow.
- Read-only dashboard: per-currency cash flow, account position, top
  categories/merchants, and attention counts; split-aware and
  transfer-excluded analytics with exact decimal-string arithmetic.
- Currency-specific budgets (weekly/monthly/yearly/custom, rollover), savings
  goals (manual and account-balance), and deterministic in-app alerts with
  database-deduplicated events.
- Optional AI advisor (disabled by default): deterministic planner, approved
  typed tools, grounded facts rendered from validated fact ids, and
  preview-and-confirm mutation proposals; no model SQL, no model tool
  selection, no provider access when disabled.
- User-controlled exports: CSV (UTF-8 BOM, CRLF, formula-injection defense),
  static-cell XLSX, and a versioned JSON ZIP archive; exact decimal strings
  with explicit currency; 24-hour expiry; authenticated private downloads.
- Better Auth authentication with optional Google/Apple OAuth, secure
  cookies, session management, and revocation.
- Production hardening: CSP with per-request nonces, security headers,
  health/readiness probes, structured logging, hardened non-root containers,
  one-shot migrations, backup/restore scripts, export orphan reconciliation,
  and a documented single-web-instance topology.
- Playwright browser suites (Chromium + Firefox) covering auth, accounts,
  imports, ledger, planning, exports, cross-user isolation, responsive/RTL/
  dark-mode checks, and a production-mode security suite.

### Known limitations

- OCR and scanned/image-only PDFs are not supported (rejected with a stable
  error).
- No currency conversion; amounts always keep their original ISO 4217
  currency and are never combined across currencies.
- The archive export is an export format, not an import/restore format.
- AI is optional and provider-limited to one OpenAI-compatible endpoint;
  advisor rate limiting is in-process, so the MVP deployment topology is
  exactly one web instance.
- PDF support covers text-based statements within the documented limits;
  malformed, encrypted, embedded-content, and oversized documents are
  rejected.
- Legacy `.xls` and macro-enabled `.xlsm` are unsupported.
- Browser automation is verified on Chromium (and Firefox locally); WebKit
  is not a release gate.
- Exports expire after 24 hours by default; notes and advisor conversations
  are opt-in and excluded by default.
- No bank APIs, investments, tax features, recurring transactions,
  forecasting, or notification channels beyond in-app alerts.
