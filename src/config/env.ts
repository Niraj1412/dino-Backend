import { config } from "dotenv";

config();

const isTestEnv = process.env.NODE_ENV === "test";

const readEnv = (key: string, defaultValue?: string): string => {
  const value = process.env[key] ?? defaultValue;

  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }

  return value;
};

const parsePort = (value: string): number => {
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid PORT: ${value}`);
  }

  return parsed;
};

const parseTtl = (value: string): number => {
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid IDEMPOTENCY_CACHE_TTL_SECONDS: ${value}`);
  }

  return parsed;
};

export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: parsePort(readEnv("PORT", "3000")),
  databaseUrl: readEnv(
    "DATABASE_URL",
    isTestEnv ? "postgresql://wallet:wallet@localhost:5432/wallet_db?schema=public" : undefined
  ),
  redisUrl: readEnv("REDIS_URL", isTestEnv ? "redis://localhost:6379" : undefined),
  idempotencyCacheTtlSeconds: parseTtl(readEnv("IDEMPOTENCY_CACHE_TTL_SECONDS", "86400")),
  distributedLockTtlMs: parseTtl(readEnv("DISTRIBUTED_LOCK_TTL_MS", "5000")),
  distributedLockRetryCount: parseTtl(readEnv("DISTRIBUTED_LOCK_RETRY_COUNT", "3")),
  distributedLockRetryDelayMs: parseTtl(readEnv("DISTRIBUTED_LOCK_RETRY_DELAY_MS", "50"))
};
