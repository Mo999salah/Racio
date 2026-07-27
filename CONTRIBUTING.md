# Contributing to Racio

Racio is built in staged phases. A contribution must name the phase and scope
it changes. Do not implement deferred product features as part of foundation
work.

## Before coding

Read `SPEC.md`, `ARCHITECTURE.md`, `DESIGN.md`, and `SECURITY.md`. Check package
licences before adding dependencies. For a visual change, identify the user
task and information priority before changing layout or components.

## Pull requests

Describe the behavioural or architectural contract changed, the checks run,
and any known limitation. Changes to money, currency, ownership, parser
boundaries, storage, or AI boundaries require focused tests and documentation.

## Local checks

Use the smallest proportional check during iteration. At a Phase 1 gate, run:

```text
pnpm lint
pnpm typecheck
pnpm test
cd apps/parser && uv run ruff check . && uv run mypy . && uv run pytest
```
