import { describe, expect, it } from "vitest";
import { AppError } from "../src/errors/app-error";
import { DistributedLockService } from "../src/services/distributed-lock";

class InMemoryLockClient {
  private readonly store = new Map<string, string>();

  async set(
    key: string,
    value: string,
    ...args: Array<string | number>
  ): Promise<string | null> {
    const mode = args[0];
    const durationMode = args[1];

    if (mode !== "NX" || durationMode !== "PX") {
      return null;
    }

    if (this.store.has(key)) {
      return null;
    }

    this.store.set(key, value);
    return "OK";
  }

  async eval(_script: string, _numKeys: number, key: string, token: string): Promise<unknown> {
    const current = this.store.get(key);

    if (current === token) {
      this.store.delete(key);
      return 1;
    }

    return 0;
  }
}

describe("distributed lock service", () => {
  it("acquires and releases deterministic wallet locks", async () => {
    const lockClient = new InMemoryLockClient();
    const service = new DistributedLockService(lockClient);

    const handle = await service.acquireWalletLocks(["wallet-b", "wallet-a"]);

    await expect(service.acquireWalletLocks(["wallet-a", "wallet-b"])).rejects.toThrowError(AppError);

    await handle.release();

    await expect(service.acquireWalletLocks(["wallet-a", "wallet-b"])).resolves.toBeDefined();
  });

  it("throws when lock list is empty", async () => {
    const lockClient = new InMemoryLockClient();
    const service = new DistributedLockService(lockClient);

    await expect(service.acquireWalletLocks([])).rejects.toThrowError(AppError);
  });
});
