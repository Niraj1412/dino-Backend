-- Add optimistic locking column
ALTER TABLE "wallets"
  ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 0;

-- Additional performance indexes
CREATE INDEX IF NOT EXISTS "idx_wallet_owner_asset_version"
  ON "wallets" ("owner_type", "asset_type_id", "version");

CREATE INDEX IF NOT EXISTS "idx_tx_status_created"
  ON "transactions" ("status", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "idx_tx_type_asset_created"
  ON "transactions" ("type", "asset_type_id", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "idx_ledger_asset_wallet_entry_created"
  ON "ledger_entries" ("asset_type_id", "wallet_id", "entry_type", "created_at" DESC);