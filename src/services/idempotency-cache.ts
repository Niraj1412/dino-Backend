import { logger } from "../config/logger";
import { env } from "../config/env";
import { redis } from "../db/redis";

export interface CachedIdempotencyPayload {
  requestFingerprint: string;
  statusCode: number;
  body: unknown;
}

const keyFor = (idempotencyKey: string): string => `idem:response:${idempotencyKey}`;

class IdempotencyCache {
  private async ensureConnection(): Promise<void> {
    if (redis.status === "ready" || redis.status === "connecting") {
      return;
    }

    if (redis.status === "wait") {
      await redis.connect();
    }
  }

  async get(idempotencyKey: string): Promise<CachedIdempotencyPayload | null> {
    try {
      await this.ensureConnection();
      const value = await redis.get(keyFor(idempotencyKey));

      if (!value) {
        return null;
      }

      return JSON.parse(value) as CachedIdempotencyPayload;
    } catch (error) {
      logger.warn({ error }, "Failed to fetch idempotency response from Redis");
      return null;
    }
  }

  async set(idempotencyKey: string, payload: CachedIdempotencyPayload): Promise<void> {
    try {
      await this.ensureConnection();
      await redis.set(
        keyFor(idempotencyKey),
        JSON.stringify(payload),
        "EX",
        env.idempotencyCacheTtlSeconds
      );
    } catch (error) {
      logger.warn({ error }, "Failed to write idempotency response to Redis");
    }
  }
}

export const idempotencyCache = new IdempotencyCache();