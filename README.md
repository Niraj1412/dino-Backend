# Wallet Service

Production-grade closed-loop wallet service using:
- Node.js (TypeScript)
- Express
- PostgreSQL
- Prisma ORM
- Redis
- Docker
- Double-entry ledger architecture

This service manages virtual credits (for example `GOLD_COINS`, `DIAMONDS`) for in-app usage only.

## 1. What This Project Delivers

Assignment requirements covered:
- Database schema: `users`, `asset_types`, `wallets`, `transactions`, `ledger_entries`.
- No balance column: balances are derived from ledger entries.
- APIs:
1. `POST /wallet/topup`
2. `POST /wallet/bonus`
3. `POST /wallet/spend`
4. `GET /wallet/:userId/balance`
- ACID transactions for all mutations.
- Row-level locking (`SELECT ... FOR UPDATE`) with deterministic lock ordering.
- Double-spend protection.
- Idempotency via `Idempotency-Key` with replay behavior.
- Seed script with assets, system wallet, users, and initial balances.
- Dockerized stack (`app`, `postgres`, `redis`) with automatic migrate + seed.
- Structured logs, validation, health checks, tests, load-test example.

## 2. High-Level Architecture

Core design:
- Double-entry ledger:
1. Source wallet gets `DEBIT`
2. Destination wallet gets `CREDIT`
- Balance is derived by:

```sql
SUM(CASE WHEN entry_type = 'CREDIT' THEN amount ELSE -amount END)
```

Concurrency controls:
- Redis distributed lock on involved wallet IDs (cross-instance safety).
- PostgreSQL row locks with `FOR UPDATE`.
- Optimistic lock with `wallets.version` increment check.
- Deterministic wallet lock ordering to reduce deadlock risk.

Idempotency:
- `transactions.idempotency_key` unique.
- Same key + same request => returns original response.
- Same key + different request => `409` conflict.

## 3. Project Structure

```text
.
|-- src
|   |-- app.ts
|   |-- server.ts
|   |-- config
|   |-- db
|   |-- errors
|   |-- middleware
|   |-- routes
|   |-- services
|   |-- types
|   `-- utils
|-- prisma
|   |-- schema.prisma
|   |-- seed.sql
|   `-- migrations
|-- tests
|-- loadtest
|-- docs
|-- Dockerfile
|-- docker-compose.yml
|-- docker-entrypoint.sh
`-- README.md
```

## 4. Prerequisites

Install these first:
- Node.js 20+
- npm 10+
- Docker + Docker Compose (recommended)

Optional tools:
- k6 for load testing

## 5. Environment Configuration

Copy template:

```bash
cp .env.example .env
```

Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

Required variables:
- `PORT`
- `DATABASE_URL`
- `REDIS_URL`
- `IDEMPOTENCY_CACHE_TTL_SECONDS`
- `DISTRIBUTED_LOCK_TTL_MS`
- `DISTRIBUTED_LOCK_RETRY_COUNT`
- `DISTRIBUTED_LOCK_RETRY_DELAY_MS`

Important:
- Do not commit `.env`.
- Use full Redis URL format: `redis://[:password@]host:port`.
- For managed Postgres, include SSL if required by provider.

## 6. Run Options

### Option A: Full stack with Docker (recommended)

```bash
docker compose up --build
```

What happens automatically:
1. PostgreSQL and Redis start.
2. App container runs migrations.
3. App container runs `prisma/seed.sql`.
4. API starts on `http://localhost:3000`.

Stop stack:

```bash
docker compose down
```

### Option B: Local app process

1. Install dependencies:

```bash
npm install
```

2. Generate Prisma client:

```bash
npm run prisma:generate
```

3. Apply migrations:

```bash
npm run migrate:deploy
```

4. Seed data:

```bash
npm run seed:sql
```

5. Start dev server:

```bash
npm run dev
```

6. Production-style start:

```bash
npm run build
npm start
```

## 7. Health Endpoints

- `GET /health`
- `GET /health/live`
- `GET /health/ready`

Examples:

```powershell
Invoke-RestMethod http://localhost:3000/health/live
Invoke-RestMethod http://localhost:3000/health/ready
```

## 8. Seeded Data

`prisma/seed.sql` initializes:
- Asset types: `GOLD_COINS`, `DIAMONDS`
- System wallets: `TREASURY`, `ISSUANCE`
- Users:
1. `alice@example.com`
2. `bob@example.com`
- Initial balances posted via ledger entries

## 9. API Reference

Base URL:
- `http://localhost:3000`

Mutating endpoints require header:
- `Idempotency-Key: <uuid-or-unique-string>`

### 9.1 Topup

`POST /wallet/topup`

Body:

```json
{
  "userId": "<uuid>",
  "assetCode": "GOLD_COINS",
  "amount": "100"
}
```

### 9.2 Bonus

`POST /wallet/bonus`

Body same as topup.

### 9.3 Spend

`POST /wallet/spend`

Body same as topup.

### 9.4 Balance

`GET /wallet/:userId/balance`

Optional query:
- `assetCode=GOLD_COINS`

## 10. API Test Guide (PowerShell)

Set base URL and user ID:

```powershell
$base = "http://localhost:3000"
$userId = "57c35933-6776-44e8-8ec8-9e9ba1cc28d6"
```

Topup:

```powershell
$key = [guid]::NewGuid().ToString()
$body = @{ userId=$userId; assetCode="GOLD_COINS"; amount="100" } | ConvertTo-Json -Compress
Invoke-RestMethod "$base/wallet/topup" -Method POST -Headers @{ "Idempotency-Key"=$key } -ContentType "application/json" -Body $body
```

Bonus:

```powershell
$key = [guid]::NewGuid().ToString()
$body = @{ userId=$userId; assetCode="GOLD_COINS"; amount="25" } | ConvertTo-Json -Compress
Invoke-RestMethod "$base/wallet/bonus" -Method POST -Headers @{ "Idempotency-Key"=$key } -ContentType "application/json" -Body $body
```

Spend:

```powershell
$key = [guid]::NewGuid().ToString()
$body = @{ userId=$userId; assetCode="GOLD_COINS"; amount="10" } | ConvertTo-Json -Compress
Invoke-RestMethod "$base/wallet/spend" -Method POST -Headers @{ "Idempotency-Key"=$key } -ContentType "application/json" -Body $body
```

Balance (all assets):

```powershell
$r = Invoke-RestMethod "$base/wallet/$userId/balance"
$r | ConvertTo-Json -Depth 10
```

Balance (single asset):

```powershell
Invoke-RestMethod "$base/wallet/$userId/balance?assetCode=GOLD_COINS" | ConvertTo-Json -Depth 10
```

Extract only GOLD_COINS balance from all-assets response:

```powershell
($r.balances | Where-Object { $_.assetCode -eq "GOLD_COINS" }).balance
```

### Idempotency replay check

```powershell
$key = [guid]::NewGuid().ToString()
$body = @{ userId=$userId; assetCode="GOLD_COINS"; amount="5" } | ConvertTo-Json -Compress
$r1 = Invoke-WebRequest "$base/wallet/spend" -Method POST -Headers @{ "Idempotency-Key"=$key } -ContentType "application/json" -Body $body
$r2 = Invoke-WebRequest "$base/wallet/spend" -Method POST -Headers @{ "Idempotency-Key"=$key } -ContentType "application/json" -Body $body
$r2.Headers["Idempotency-Replayed"]
```

## 11. Why You Might See "Different" Balance in PowerShell

`Invoke-RestMethod` prints nested arrays in compact form (`@{...}`), so it can look like balance is different.

Use:

```powershell
Invoke-RestMethod "$base/wallet/$userId/balance" | ConvertTo-Json -Depth 10
```

Then verify the `GOLD_COINS` entry. `DIAMONDS` and `GOLD_COINS` both appear in the same response.

## 12. Validation, Error Behavior, and Status Codes

Validation:
- Zod validation for body, params, and query.
- `amount` must be positive integer.

Common statuses:
- `200` success.
- `400` validation/idempotency header missing.
- `404` user/asset wallet not found.
- `409` insufficient funds, in-progress idempotency, optimistic lock conflict.
- `423` distributed lock not acquired.
- `500` unexpected server errors.

## 13. Testing

Unit tests:

```bash
npm test
```

Typecheck/build:

```bash
npm run build
```

Load test (k6):

```bash
k6 run -e BASE_URL=http://localhost:3000 -e USER_ID=<uuid> -e ASSET_CODE=GOLD_COINS loadtest/wallet-spend.k6.js
```

## 14. SQL Plan Analysis

See `docs/explain.md` for `EXPLAIN (ANALYZE, BUFFERS)` queries and index expectations.

## 15. Troubleshooting

### Invalid URI: hostname could not be parsed
Cause:
- `$base` variable not set in current shell.

Fix:

```powershell
$base = "http://localhost:3000"
```

### `P2021`: table does not exist
Fix:

```bash
npm run migrate:deploy
npm run seed:sql
```

### `EADDRINUSE: address already in use`
Cause:
- another process is using your port.

Fix:
- stop that process, or set another port:

```powershell
$env:PORT="3001"
npm run dev
```

### `P1017`: server closed connection
Cause:
- DB URL/SSL/auth/provider connectivity issue.

Fix:
- validate `DATABASE_URL`.
- add SSL params required by provider.
- check provider DB status.

### `/ _next / webpack-hmr` 404 logs
Cause:
- frontend dev server traffic reaching backend port.

Fix:
- run backend and frontend on different ports.

## 16. Security Notes

- Rotate any credentials that were ever committed/shared accidentally.
- Keep `.env` local only.
- Use least-privilege DB/Redis credentials for production.

## 17. Submission Checklist (Assignment)

Before submission:
1. `npm run build` passes.
2. `npm test` passes.
3. `docker compose up --build` works.
4. Seed data exists and APIs are testable immediately.
5. README steps are reproducible.
6. `.env` is not included in repo/zip.

Deliverables:
- Source code.
- `prisma/seed.sql`.
- `README.md`.
- `Dockerfile` + `docker-compose.yml`.
- Optional bonus: hosted public URL.
