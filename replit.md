# FINTRACE

Financial investigation and legal intelligence workspace for Karnataka Lokayukta disproportionate-assets (DA) cases (Income Tax scrutiny planned), used by accused persons, advocates, CAs and investigating officers.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `lib/api-spec/openapi.yaml` — API contract (source of truth); run codegen after edits
- `lib/db/src/schema/` — Drizzle tables (users, cases, finance, investigation)
- `artifacts/api-server/src/lib/` — engines: `statementImport`, `classify`, `reconcile`, `schedules` (I&E, DA A/B/C/D, blind spots), `reports` (xlsx/pdf/docx), `ai`, `demo`, `access`, `audit`
- `artifacts/api-server/src/routes/` — one router per area, all behind `requireUser` except `/healthz`
- `artifacts/fintrace/src/` — React frontend (pages per case tab, shared components)

## Architecture decisions

- The app never decides guilt; AI output is a suggestion until a user approves it; only approved categories feed schedules.
- Imported transaction values are kept in `orig*` columns; corrections require a reason and are audited. `audit_logs` is append-only with no FK to cases.
- Access = case owner, or a `case_shares` row matched by lowercased email (editor / reviewer / investigator).
- Legal references are seeded unverified with no invented citations/dates; AI may cite only verified, case-linked references.
- PDF statements return "unsupported" (no OCR); import accepts CSV text or base64 xlsx.

## Product

Cases, bank accounts & statement import, transaction ledger with rule suggestions, reconciliation matching, income/expenditure, DA working, assets/liabilities/family, investigation queries with response approval and assessments, documents (App Storage + SHA-256), legal library, AI assistant, report exports, audit trail, labelled demo case.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- Zod body schemas must not coerce dates (DB uses date strings); orval zod config has `useDates: false` and body coerce only `bigint`.
- Do not zod-parse responses on the server.
- `pdfkit`, `fontkit`, `exceljs` are esbuild externals (pdfkit reads data files at runtime).

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
