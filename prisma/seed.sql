-- Seed data for wallet service (idempotent)

-- Asset types
INSERT INTO asset_types (code, name)
VALUES
  ('GOLD_COINS', 'Gold Coins'),
  ('DIAMONDS', 'Diamonds')
ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name;

-- Users
INSERT INTO users (email)
VALUES
  ('alice@example.com'),
  ('bob@example.com')
ON CONFLICT (email) DO NOTHING;

-- System wallets: Treasury and Issuance (issuance only used for bootstrap funding)
WITH asset_rows AS (
  SELECT id AS asset_type_id, code FROM asset_types WHERE code IN ('GOLD_COINS', 'DIAMONDS')
)
INSERT INTO wallets (owner_type, system_code, asset_type_id)
SELECT 'SYSTEM'::"WalletOwnerType", 'TREASURY', asset_rows.asset_type_id
FROM asset_rows
ON CONFLICT (owner_type, system_code, asset_type_id) DO NOTHING;

WITH asset_rows AS (
  SELECT id AS asset_type_id, code FROM asset_types WHERE code IN ('GOLD_COINS', 'DIAMONDS')
)
INSERT INTO wallets (owner_type, system_code, asset_type_id)
SELECT 'SYSTEM'::"WalletOwnerType", 'ISSUANCE', asset_rows.asset_type_id
FROM asset_rows
ON CONFLICT (owner_type, system_code, asset_type_id) DO NOTHING;

-- User wallets for each asset type
WITH user_rows AS (
  SELECT id AS user_id FROM users WHERE email IN ('alice@example.com', 'bob@example.com')
),
asset_rows AS (
  SELECT id AS asset_type_id FROM asset_types WHERE code IN ('GOLD_COINS', 'DIAMONDS')
)
INSERT INTO wallets (owner_type, user_id, asset_type_id)
SELECT 'USER'::"WalletOwnerType", user_rows.user_id, asset_rows.asset_type_id
FROM user_rows
CROSS JOIN asset_rows
ON CONFLICT (owner_type, user_id, asset_type_id) DO NOTHING;

-- Bootstrap Treasury funding from Issuance wallet
WITH tx AS (
  INSERT INTO transactions (
    idempotency_key,
    request_hash,
    type,
    status,
    amount,
    asset_type_id,
    source_wallet_id,
    destination_wallet_id,
    response_code,
    response_body
  )
  SELECT
    'seed-bootstrap-gold' AS idempotency_key,
    md5('seed-bootstrap-gold') AS request_hash,
    'TOPUP'::"TransactionType",
    'POSTED'::"TransactionStatus",
    1000000::bigint,
    a.id,
    ws.id,
    wt.id,
    200,
    jsonb_build_object('seed', true, 'description', 'Bootstrap treasury gold funding')
  FROM asset_types a
  JOIN wallets ws ON ws.asset_type_id = a.id AND ws.owner_type = 'SYSTEM'::"WalletOwnerType" AND ws.system_code = 'ISSUANCE'
  JOIN wallets wt ON wt.asset_type_id = a.id AND wt.owner_type = 'SYSTEM'::"WalletOwnerType" AND wt.system_code = 'TREASURY'
  WHERE a.code = 'GOLD_COINS'
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING id, asset_type_id, source_wallet_id, destination_wallet_id, amount
)
INSERT INTO ledger_entries (transaction_id, wallet_id, asset_type_id, entry_type, amount)
SELECT id, source_wallet_id, asset_type_id, 'DEBIT'::"EntryType", amount FROM tx
UNION ALL
SELECT id, destination_wallet_id, asset_type_id, 'CREDIT'::"EntryType", amount FROM tx;

WITH tx AS (
  INSERT INTO transactions (
    idempotency_key,
    request_hash,
    type,
    status,
    amount,
    asset_type_id,
    source_wallet_id,
    destination_wallet_id,
    response_code,
    response_body
  )
  SELECT
    'seed-bootstrap-diamond' AS idempotency_key,
    md5('seed-bootstrap-diamond') AS request_hash,
    'TOPUP'::"TransactionType",
    'POSTED'::"TransactionStatus",
    100000::bigint,
    a.id,
    ws.id,
    wt.id,
    200,
    jsonb_build_object('seed', true, 'description', 'Bootstrap treasury diamond funding')
  FROM asset_types a
  JOIN wallets ws ON ws.asset_type_id = a.id AND ws.owner_type = 'SYSTEM'::"WalletOwnerType" AND ws.system_code = 'ISSUANCE'
  JOIN wallets wt ON wt.asset_type_id = a.id AND wt.owner_type = 'SYSTEM'::"WalletOwnerType" AND wt.system_code = 'TREASURY'
  WHERE a.code = 'DIAMONDS'
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING id, asset_type_id, source_wallet_id, destination_wallet_id, amount
)
INSERT INTO ledger_entries (transaction_id, wallet_id, asset_type_id, entry_type, amount)
SELECT id, source_wallet_id, asset_type_id, 'DEBIT'::"EntryType", amount FROM tx
UNION ALL
SELECT id, destination_wallet_id, asset_type_id, 'CREDIT'::"EntryType", amount FROM tx;

-- Initial balances: Alice and Bob
WITH tx AS (
  INSERT INTO transactions (
    idempotency_key,
    request_hash,
    type,
    status,
    amount,
    asset_type_id,
    source_wallet_id,
    destination_wallet_id,
    response_code,
    response_body
  )
  SELECT
    'seed-alice-gold' AS idempotency_key,
    md5('seed-alice-gold') AS request_hash,
    'BONUS'::"TransactionType",
    'POSTED'::"TransactionStatus",
    1000::bigint,
    a.id,
    wt.id,
    wu.id,
    200,
    jsonb_build_object('seed', true, 'description', 'Initial Alice gold balance')
  FROM users u
  JOIN asset_types a ON a.code = 'GOLD_COINS'
  JOIN wallets wt ON wt.asset_type_id = a.id AND wt.owner_type = 'SYSTEM'::"WalletOwnerType" AND wt.system_code = 'TREASURY'
  JOIN wallets wu ON wu.asset_type_id = a.id AND wu.owner_type = 'USER'::"WalletOwnerType" AND wu.user_id = u.id
  WHERE u.email = 'alice@example.com'
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING id, asset_type_id, source_wallet_id, destination_wallet_id, amount
)
INSERT INTO ledger_entries (transaction_id, wallet_id, asset_type_id, entry_type, amount)
SELECT id, source_wallet_id, asset_type_id, 'DEBIT'::"EntryType", amount FROM tx
UNION ALL
SELECT id, destination_wallet_id, asset_type_id, 'CREDIT'::"EntryType", amount FROM tx;

WITH tx AS (
  INSERT INTO transactions (
    idempotency_key,
    request_hash,
    type,
    status,
    amount,
    asset_type_id,
    source_wallet_id,
    destination_wallet_id,
    response_code,
    response_body
  )
  SELECT
    'seed-alice-diamond' AS idempotency_key,
    md5('seed-alice-diamond') AS request_hash,
    'BONUS'::"TransactionType",
    'POSTED'::"TransactionStatus",
    50::bigint,
    a.id,
    wt.id,
    wu.id,
    200,
    jsonb_build_object('seed', true, 'description', 'Initial Alice diamond balance')
  FROM users u
  JOIN asset_types a ON a.code = 'DIAMONDS'
  JOIN wallets wt ON wt.asset_type_id = a.id AND wt.owner_type = 'SYSTEM'::"WalletOwnerType" AND wt.system_code = 'TREASURY'
  JOIN wallets wu ON wu.asset_type_id = a.id AND wu.owner_type = 'USER'::"WalletOwnerType" AND wu.user_id = u.id
  WHERE u.email = 'alice@example.com'
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING id, asset_type_id, source_wallet_id, destination_wallet_id, amount
)
INSERT INTO ledger_entries (transaction_id, wallet_id, asset_type_id, entry_type, amount)
SELECT id, source_wallet_id, asset_type_id, 'DEBIT'::"EntryType", amount FROM tx
UNION ALL
SELECT id, destination_wallet_id, asset_type_id, 'CREDIT'::"EntryType", amount FROM tx;

WITH tx AS (
  INSERT INTO transactions (
    idempotency_key,
    request_hash,
    type,
    status,
    amount,
    asset_type_id,
    source_wallet_id,
    destination_wallet_id,
    response_code,
    response_body
  )
  SELECT
    'seed-bob-gold' AS idempotency_key,
    md5('seed-bob-gold') AS request_hash,
    'BONUS'::"TransactionType",
    'POSTED'::"TransactionStatus",
    500::bigint,
    a.id,
    wt.id,
    wu.id,
    200,
    jsonb_build_object('seed', true, 'description', 'Initial Bob gold balance')
  FROM users u
  JOIN asset_types a ON a.code = 'GOLD_COINS'
  JOIN wallets wt ON wt.asset_type_id = a.id AND wt.owner_type = 'SYSTEM'::"WalletOwnerType" AND wt.system_code = 'TREASURY'
  JOIN wallets wu ON wu.asset_type_id = a.id AND wu.owner_type = 'USER'::"WalletOwnerType" AND wu.user_id = u.id
  WHERE u.email = 'bob@example.com'
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING id, asset_type_id, source_wallet_id, destination_wallet_id, amount
)
INSERT INTO ledger_entries (transaction_id, wallet_id, asset_type_id, entry_type, amount)
SELECT id, source_wallet_id, asset_type_id, 'DEBIT'::"EntryType", amount FROM tx
UNION ALL
SELECT id, destination_wallet_id, asset_type_id, 'CREDIT'::"EntryType", amount FROM tx;

WITH tx AS (
  INSERT INTO transactions (
    idempotency_key,
    request_hash,
    type,
    status,
    amount,
    asset_type_id,
    source_wallet_id,
    destination_wallet_id,
    response_code,
    response_body
  )
  SELECT
    'seed-bob-diamond' AS idempotency_key,
    md5('seed-bob-diamond') AS request_hash,
    'BONUS'::"TransactionType",
    'POSTED'::"TransactionStatus",
    20::bigint,
    a.id,
    wt.id,
    wu.id,
    200,
    jsonb_build_object('seed', true, 'description', 'Initial Bob diamond balance')
  FROM users u
  JOIN asset_types a ON a.code = 'DIAMONDS'
  JOIN wallets wt ON wt.asset_type_id = a.id AND wt.owner_type = 'SYSTEM'::"WalletOwnerType" AND wt.system_code = 'TREASURY'
  JOIN wallets wu ON wu.asset_type_id = a.id AND wu.owner_type = 'USER'::"WalletOwnerType" AND wu.user_id = u.id
  WHERE u.email = 'bob@example.com'
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING id, asset_type_id, source_wallet_id, destination_wallet_id, amount
)
INSERT INTO ledger_entries (transaction_id, wallet_id, asset_type_id, entry_type, amount)
SELECT id, source_wallet_id, asset_type_id, 'DEBIT'::"EntryType", amount FROM tx
UNION ALL
SELECT id, destination_wallet_id, asset_type_id, 'CREDIT'::"EntryType", amount FROM tx;