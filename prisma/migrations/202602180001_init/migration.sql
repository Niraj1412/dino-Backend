-- Create extension for UUID generation
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- CreateEnum
CREATE TYPE "WalletOwnerType" AS ENUM ('USER', 'SYSTEM');
CREATE TYPE "TransactionType" AS ENUM ('TOPUP', 'BONUS', 'SPEND');
CREATE TYPE "TransactionStatus" AS ENUM ('PROCESSING', 'POSTED', 'FAILED');
CREATE TYPE "EntryType" AS ENUM ('DEBIT', 'CREDIT');

-- CreateTable: users
CREATE TABLE "users" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "email" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable: asset_types
CREATE TABLE "asset_types" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "asset_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable: wallets
CREATE TABLE "wallets" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID,
  "owner_type" "WalletOwnerType" NOT NULL,
  "system_code" TEXT,
  "asset_type_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "wallets_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "wallets_owner_shape_chk" CHECK (
    ("owner_type" = 'USER'::"WalletOwnerType" AND "user_id" IS NOT NULL AND "system_code" IS NULL)
    OR
    ("owner_type" = 'SYSTEM'::"WalletOwnerType" AND "user_id" IS NULL AND "system_code" IS NOT NULL)
  )
);

-- CreateTable: transactions
CREATE TABLE "transactions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "idempotency_key" TEXT NOT NULL,
  "request_hash" TEXT NOT NULL,
  "type" "TransactionType" NOT NULL,
  "status" "TransactionStatus" NOT NULL DEFAULT 'PROCESSING'::"TransactionStatus",
  "amount" BIGINT NOT NULL,
  "asset_type_id" UUID NOT NULL,
  "source_wallet_id" UUID NOT NULL,
  "destination_wallet_id" UUID NOT NULL,
  "response_code" INTEGER,
  "response_body" JSONB,
  "error_code" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "transactions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "transactions_amount_positive_chk" CHECK ("amount" > 0)
);

-- CreateTable: ledger_entries
CREATE TABLE "ledger_entries" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "transaction_id" UUID NOT NULL,
  "wallet_id" UUID NOT NULL,
  "asset_type_id" UUID NOT NULL,
  "entry_type" "EntryType" NOT NULL,
  "amount" BIGINT NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ledger_entries_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ledger_entries_amount_positive_chk" CHECK ("amount" > 0)
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users" ("email");
CREATE UNIQUE INDEX "asset_types_code_key" ON "asset_types" ("code");
CREATE UNIQUE INDEX "uq_wallet_owner_user_asset" ON "wallets" ("owner_type", "user_id", "asset_type_id");
CREATE UNIQUE INDEX "uq_wallet_owner_system_asset" ON "wallets" ("owner_type", "system_code", "asset_type_id");
CREATE INDEX "idx_wallet_user_asset" ON "wallets" ("user_id", "asset_type_id");
CREATE INDEX "idx_wallet_system" ON "wallets" ("owner_type", "system_code");
CREATE UNIQUE INDEX "transactions_idempotency_key_key" ON "transactions" ("idempotency_key");
CREATE INDEX "idx_tx_asset_created" ON "transactions" ("asset_type_id", "created_at");
CREATE INDEX "idx_tx_source_wallet" ON "transactions" ("source_wallet_id");
CREATE INDEX "idx_tx_destination_wallet" ON "transactions" ("destination_wallet_id");
CREATE INDEX "idx_ledger_wallet_asset_created" ON "ledger_entries" ("wallet_id", "asset_type_id", "created_at");
CREATE INDEX "idx_ledger_transaction" ON "ledger_entries" ("transaction_id");

-- Foreign Keys
ALTER TABLE "wallets"
  ADD CONSTRAINT "wallets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "wallets_asset_type_id_fkey" FOREIGN KEY ("asset_type_id") REFERENCES "asset_types" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "transactions"
  ADD CONSTRAINT "transactions_asset_type_id_fkey" FOREIGN KEY ("asset_type_id") REFERENCES "asset_types" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "transactions_source_wallet_id_fkey" FOREIGN KEY ("source_wallet_id") REFERENCES "wallets" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "transactions_destination_wallet_id_fkey" FOREIGN KEY ("destination_wallet_id") REFERENCES "wallets" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ledger_entries"
  ADD CONSTRAINT "ledger_entries_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transactions" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ledger_entries_wallet_id_fkey" FOREIGN KEY ("wallet_id") REFERENCES "wallets" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ledger_entries_asset_type_id_fkey" FOREIGN KEY ("asset_type_id") REFERENCES "asset_types" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Keep updated_at in sync
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_transactions_updated_at
BEFORE UPDATE ON "transactions"
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();