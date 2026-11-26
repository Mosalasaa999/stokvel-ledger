# StokvelLedger — Zero-Custody South African Stokvel Ledger

A zero-custody, **100% browser-parsed**, PIN-accessed digital ledger and automated bank-statement reconciler built for South African stokvels, burial societies, and savings clubs at **R0 fixed monthly infrastructure burn**.

## Architecture
- **Frontend (`frontend/`):** React 18, TypeScript, Vite, Tailwind CSS v3 (zero `backdrop-blur`), Zustand + IndexedDB offline cache, `jsPDF` client-side GN 404 certificates, and `ingest.worker.ts` (`pdfjs-dist` right-edge `(x + width, y)` table parser, `fflate` zipped OFX, `papaparse` CSV).
- **Backend (`backend/`):** Go 1.22 (`net/http`, `CGO_ENABLED=0` static Alpine container), `argon2id` 16 MiB PIN hashing, 5 req/min IP limiter, FIFO `SELECT ... FOR UPDATE` obligation allocation, atomic batch rollbacks, SHA-256 idempotency.
- **Database:** Neon PostgreSQL Free Tier (EU Frankfurt, `BIGINT` integer-cent arithmetic).

## Compliance & Privacy
- **Non-Custodial (Banks Act GN 404 / SARB NPS / FICA / FAIS):** Zero fiat custody; client-side `jsPDF` formats GN 404 annual statements.
- **NCA GN 513 (R0.00 Threshold):** Blocks interest/fee loans (`422`); permits 0% principal advances only.
- **POPIA Section 72 (EU Pinning):** Raw statements stay in browser RAM; zero SA IDs or bank account numbers stored in Postgres.

## Deploy via Render Blueprint
1. Create a free **Neon** database in **Europe (Frankfurt)** and copy the `?sslmode=require` connection string.
2. Push this repo to GitHub and create a **Render Blueprint** (`render.yaml`).
