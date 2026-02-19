import { AppError } from "../errors/app-error";

export const sortUniqueWalletIds = (walletIds: string[]): string[] =>
  [...new Set(walletIds)].sort((left, right) => left.localeCompare(right));

export const toWalletLockKeys = (walletIds: string[]): string[] =>
  sortUniqueWalletIds(walletIds).map((walletId) => `lock:wallet:${walletId}`);

export const assertOptimisticWalletUpdates = (
  results: Array<{ walletId: string; updatedCount: number }>
): void => {
  const conflicted = results.find((result) => result.updatedCount !== 1);

  if (!conflicted) {
    return;
  }

  throw new AppError(
    409,
    "OPTIMISTIC_LOCK_CONFLICT",
    `Concurrent wallet update detected for wallet ${conflicted.walletId}`
  );
};