import { randomUUID } from "crypto";
import { env } from "../config/env";
import { logger } from "../config/logger";
import { redis } from "../db/redis";
import { AppError } from "../errors/app-error";
import { toWalletLockKeys } from "./concurrency-controls";

interface LockClient {
  set(key: string, value: string, ...args: Array<string | number>): Promise<string | null>;
  eval(script: string, numKeys: number, key: string, token: string): Promise<unknown>;
}

const RELEASE_LOCK_SCRIPT = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
else
  return 0
end
`;

const sleep = async (milliseconds: number): Promise<void> => {
  await new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
};

export interface DistributedLockHandle {
  release: () => Promise<void>;
}

export class DistributedLockService {
  constructor(private readonly lockClient: LockClient) {}

  async acquireWalletLocks(walletIds: string[]): Promise<DistributedLockHandle> {
    const lockKeys = toWalletLockKeys(walletIds);

    if (lockKeys.length === 0) {
      throw new AppError(400, "LOCK_KEYS_MISSING", "No lock keys were provided");
    }

    const token = randomUUID();
    let acquiredKeys: string[] = [];

    for (let attempt = 1; attempt <= env.distributedLockRetryCount; attempt += 1) {
      acquiredKeys = [];
      let locked = true;

      for (const lockKey of lockKeys) {
        const result = await this.lockClient.set(
          lockKey,
          token,
          "NX",
          "PX",
          env.distributedLockTtlMs
        );

        if (result !== "OK") {
          locked = false;
          break;
        }

        acquiredKeys.push(lockKey);
      }

      if (locked) {
        return {
          release: async () => {
            await this.releaseLocks(acquiredKeys, token);
          }
        };
      }

      await this.releaseLocks(acquiredKeys, token);

      if (attempt < env.distributedLockRetryCount) {
        await sleep(env.distributedLockRetryDelayMs * attempt);
      }
    }

    throw new AppError(
      423,
      "DISTRIBUTED_LOCK_NOT_ACQUIRED",
      "Could not acquire wallet lock. Please retry."
    );
  }

  private async releaseLocks(lockKeys: string[], token: string): Promise<void> {
    if (lockKeys.length === 0) {
      return;
    }

    for (const lockKey of lockKeys) {
      try {
        await this.lockClient.eval(RELEASE_LOCK_SCRIPT, 1, lockKey, token);
      } catch (error) {
        logger.warn({ error, lockKey }, "Failed to release distributed lock");
      }
    }
  }
}

const redisLockClient: LockClient = {
  set: (key, value, ...args) =>
    (redis.set as unknown as (...params: Array<string | number>) => Promise<string | null>)(
      key,
      value,
      ...args
    ),
  eval: (script, numKeys, key, token) =>
    (redis.eval as unknown as (...params: Array<string | number>) => Promise<unknown>)(
      script,
      numKeys,
      key,
      token
    )
};

export const distributedLockService = new DistributedLockService(redisLockClient);
