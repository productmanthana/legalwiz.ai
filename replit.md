# FINTRACE

Financial investigation and legal intelligence workspace for Karnataka Lokayukta disproportionate-assets (DA) cases and Income Tax scrutiny, used by accused persons, advocates, CAs and investigating officers.

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
- `artifacts/api-server/src/lib/` — engines: `statementImport`, `classify`, `reconcile`, `schedules` (I&E, DA A/B/C/D, blind spots), `incomeTax` (bank credits vs ITR, AIS/26AS vs ITR per head; pure `compareIncomeTax`), `reports` (xlsx/pdf/docx), `ai`, `demo`, `access`, `audit`
- `artifacts/api-server/src/routes/` — one router per area, all behind `requireUser` except `/healthz`
- `artifacts/fintrace/src/` — React frontend (pages per case tab, shared components)

## Architecture decisions

- The app never decides guilt; AI output is a suggestion until a user approves it; only approved categories feed schedules.
- Imported transaction values are kept in `orig*` columns; corrections require a reason and are audited. `audit_logs` is append-only with no FK to cases.
- Access = case owner, or a `case_shares` row matched by lowercased email (editor / reviewer / investigator).
- Legal references are seeded unverified with no invented citations/dates; AI may cite only verified, case-linked references.
- PDF statements return "unsupported" (no OCR); import accepts CSV text or base64 xlsx.
- Document search: every uploaded document is read in the background (`lib/documentExtract` → `lib/documentIndex`) and stored as page-level passages in Weaviate (`lib/weaviate`, v3 gRPC client). One collection `FintraceDocumentChunk`, multi-tenant with **one tenant per case** (`case_<id>`), vectorised in Weaviate Cloud (`text2vec-weaviate`). The AI assistant does a hybrid search in the case tenant and cites document + page.
- Extraction routing: txt/csv/json/unknown-text → direct; xlsx/xls/ods → one page per sheet; docx without images → direct (mammoth); PDF → per page `pdftotext`, and pages that are scanned (<40 chars) or carry an image ≥300×200 px are rendered (`pdftoppm`) and read by the vision model (full OCR for scanned, visual-only for mixed pages); docx with images, doc/rtf/odt/ppt(x) → LibreOffice → PDF path; images → vision OCR.

## Product

Cases, bank accounts & statement import, transaction ledger with rule suggestions, reconciliation matching, income/expenditure, DA working, Income Tax scrutiny (tax-record figures + year-wise comparison), assets/liabilities/family, investigation queries with response approval and assessments, documents (App Storage + SHA-256), legal library, AI assistant, report exports, audit trail, labelled demo case.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- Zod body schemas must not coerce dates (DB uses date strings); orval zod config has `useDates: false` and body coerce only `bigint`.
- Do not zod-parse responses on the server.
- `pdfkit`, `fontkit`, `exceljs`, `weaviate-client` are esbuild externals (pdfkit reads data files at runtime).
- Document indexing env: `WEAVIATE_URL` (scheme optional), `WEAVIATE_API_KEY`; vision via `AI_INTEGRATIONS_OPENAI_*` or `OPENAI_API_KEY` (`VISION_MODEL` default `gpt-4o`, `MAX_VISION_PAGES_PER_DOCUMENT` default 500). Without Weaviate, documents stay `not_indexed`; without a vision key, scanned/image pages index only their text layer and the document records a warning.
- System binaries needed on the API host: `poppler-utils` (pdftotext, pdfimages, pdftoppm) and, for Word-with-images/other office formats, LibreOffice (`soffice`).
- New `documents.index_*` columns need `pnpm --filter @workspace/db run push`.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
