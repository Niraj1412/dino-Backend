import { describe, expect, it } from "vitest";
import { AppError } from "../src/errors/app-error";
import {
  assertOptimisticWalletUpdates,
  sortUniqueWalletIds,
  toWalletLockKeys
} from "../src/services/concurrency-controls";

describe("concurrency controls", () => {
  it("sorts wallet ids deterministically and removes duplicates", () => {
    const first = sortUniqueWalletIds(["wallet-b", "wallet-a", "wallet-b"]);
    const second = sortUniqueWalletIds(["wallet-a", "wallet-b"]);

    expect(first).toEqual(["wallet-a", "wallet-b"]);
    expect(second).toEqual(["wallet-a", "wallet-b"]);
  });

  it("builds deterministic distributed lock keys", () => {
    const keys = toWalletLockKeys(["w2", "w1", "w1"]);

    expect(keys).toEqual(["lock:wallet:w1", "lock:wallet:w2"]);
  });

  it("throws on optimistic locking conflicts", () => {
    expect(() =>
      assertOptimisticWalletUpdates([
        { walletId: "wallet-a", updatedCount: 1 },
        { walletId: "wallet-b", updatedCount: 0 }
      ])
    ).toThrowError(AppError);
  });

  it("passes when all optimistic updates are successful", () => {
    expect(() =>
      assertOptimisticWalletUpdates([
        { walletId: "wallet-a", updatedCount: 1 },
        { walletId: "wallet-b", updatedCount: 1 }
      ])
    ).not.toThrow();
  });
});