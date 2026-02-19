# Database EXPLAIN Guide

This document shows how to inspect key wallet queries and confirm index usage.

## 1. Balance Derivation Query

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT COALESCE(
  SUM(CASE WHEN entry_type = 'CREDIT' THEN amount ELSE -amount END),
  0
) AS balance
FROM ledger_entries
WHERE wallet_id = '00000000-0000-0000-0000-000000000000'::uuid
  AND asset_type_id = '00000000-0000-0000-0000-000000000000'::uuid;
```

Expected index:
- `idx_ledger_wallet_asset_created`

Goal:
- Plan should avoid full table scan for large ledgers.

## 2. Wallet Row Lock Query

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, version
FROM wallets
WHERE id IN (
  '00000000-0000-0000-0000-000000000001'::uuid,
  '00000000-0000-0000-0000-000000000002'::uuid
)
ORDER BY id
FOR UPDATE;
```

Expected index:
- `wallets_pkey`

Goal:
- Fast lock acquisition on exact wallet IDs.

## 3. Idempotency Lookup

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, response_code, response_body
FROM transactions
WHERE idempotency_key = 'sample-idempotency-key';
```

Expected index:
- `transactions_idempotency_key_key`

Goal:
- O(log N) replay lookup.

## 4. Recent Transaction Monitoring

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, status, created_at
FROM transactions
WHERE status = 'PROCESSING'
ORDER BY created_at DESC
LIMIT 100;
```

Expected index:
- `idx_tx_status_created`

Goal:
- Efficient operational dashboards and stuck-transaction checks.

## 5. Asset Transaction Timeline

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, type, amount, created_at
FROM transactions
WHERE type = 'SPEND'
  AND asset_type_id = '00000000-0000-0000-0000-000000000000'::uuid
ORDER BY created_at DESC
LIMIT 100;
```

Expected index:
- `idx_tx_type_asset_created`

Goal:
- Efficient reads for analytics/reporting by operation type.

## Interpretation Checklist

- `Index Scan` or `Bitmap Index Scan` should appear for hot-path lookups.
- `Seq Scan` on `ledger_entries` or `transactions` under production volume indicates index mismatch.
- Watch `actual time`, `rows`, and `shared read blocks` for regressions after schema changes.

## How to Run

```bash
docker compose exec postgres psql -U wallet -d wallet_db
```

Then run each `EXPLAIN` query with real IDs from your dataset.