import {
  EntryType,
  Prisma,
  TransactionStatus,
  TransactionType,
  WalletOwnerType
} from "@prisma/client";
import { prisma } from "../db/prisma";
import { AppError } from "../errors/app-error";
import {
  assertOptimisticWalletUpdates,
  sortUniqueWalletIds
} from "./concurrency-controls";
import { distributedLockService } from "./distributed-lock";
import { idempotencyCache } from "./idempotency-cache";

const TREASURY_SYSTEM_CODE = "TREASURY";

type WalletOperation = "topup" | "bonus" | "spend";

type ErrorPayload = {
  error: {
    code: string;
    message: string;
  };
};

type WalletMutationSuccessPayload = {
  transactionId: string;
  idempotencyKey: string;
  operation: WalletOperation;
  userId: string;
  assetCode: string;
  amount: string;
  balance: string;
  fromWalletId: string;
  toWalletId: string;
  createdAt: string;
};

export type WalletMutationPayload = WalletMutationSuccessPayload | ErrorPayload;

export interface WalletMutationRequest {
  userId: string;
  assetCode: string;
  amount: bigint;
  idempotencyKey: string;
  requestFingerprint: string;
}

export interface WalletMutationResult {
  statusCode: number;
  body: WalletMutationPayload;
  replayed: boolean;
}

export interface WalletBalanceResponse {
  userId: string;
  balances: Array<{
    assetCode: string;
    assetName: string;
    balance: string;
  }>;
}

type LedgerBalanceRow = {
  balance: bigint | string | number | null;
};

type UserBalanceRow = {
  assetCode: string;
  assetName: string;
  balance: bigint | string | number | null;
};

type LockedWalletRow = {
  id: string;
  version: number | string;
};

interface WalletExecutionContext {
  assetTypeId: string;
  assetCode: string;
  userWalletId: string;
  treasuryWalletId: string;
}

const toBigInt = (value: bigint | string | number | null): bigint => {
  if (value === null) {
    return 0n;
  }

  if (typeof value === "bigint") {
    return value;
  }

  return BigInt(value);
};

const toNumber = (value: number | string): number => {
  if (typeof value === "number") {
    return value;
  }

  return Number(value);
};

const operationLabel = (type: TransactionType): WalletOperation => {
  switch (type) {
    case TransactionType.TOPUP:
      return "topup";
    case TransactionType.BONUS:
      return "bonus";
    case TransactionType.SPEND:
      return "spend";
    default:
      return "topup";
  }
};

export class WalletService {
  async topup(input: WalletMutationRequest): Promise<WalletMutationResult> {
    return this.executeMutation(TransactionType.TOPUP, input);
  }

  async bonus(input: WalletMutationRequest): Promise<WalletMutationResult> {
    return this.executeMutation(TransactionType.BONUS, input);
  }

  async spend(input: WalletMutationRequest): Promise<WalletMutationResult> {
    return this.executeMutation(TransactionType.SPEND, input);
  }

  async getBalance(userId: string, assetCode?: string): Promise<WalletBalanceResponse> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true }
    });

    if (!user) {
      throw new AppError(404, "USER_NOT_FOUND", "User does not exist");
    }

    const normalizedAssetCode = assetCode?.toUpperCase();
    const assetFilter = normalizedAssetCode
      ? Prisma.sql`AND a.code = ${normalizedAssetCode}`
      : Prisma.empty;

    const rows = await prisma.$queryRaw<UserBalanceRow[]>(Prisma.sql`
      SELECT
        a.code AS "assetCode",
        a.name AS "assetName",
        COALESCE(
          SUM(CASE WHEN le.entry_type = 'CREDIT'::"EntryType" THEN le.amount ELSE -le.amount END),
          0
        )::bigint AS balance
      FROM wallets w
      JOIN asset_types a ON a.id = w.asset_type_id
      LEFT JOIN ledger_entries le
        ON le.wallet_id = w.id
        AND le.asset_type_id = w.asset_type_id
      WHERE w.owner_type = 'USER'::"WalletOwnerType"
        AND w.user_id = ${userId}::uuid
        ${assetFilter}
      GROUP BY a.code, a.name
      ORDER BY a.code
    `);

    if (normalizedAssetCode && rows.length === 0) {
      throw new AppError(
        404,
        "ASSET_WALLET_NOT_FOUND",
        `User does not have a wallet for asset ${normalizedAssetCode}`
      );
    }

    return {
      userId,
      balances: rows.map((row) => ({
        assetCode: row.assetCode,
        assetName: row.assetName,
        balance: toBigInt(row.balance).toString()
      }))
    };
  }

  private async executeMutation(
    type: TransactionType,
    input: WalletMutationRequest
  ): Promise<WalletMutationResult> {
    const cached = await idempotencyCache.get(input.idempotencyKey);

    if (cached) {
      if (cached.requestFingerprint !== input.requestFingerprint) {
        throw new AppError(
          409,
          "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST",
          "Idempotency-Key has already been used with a different request payload"
        );
      }

      return {
        statusCode: cached.statusCode,
        body: cached.body as WalletMutationPayload,
        replayed: true
      };
    }

    const context = await this.resolveContext(input.userId, input.assetCode);
    const sourceWalletId =
      type === TransactionType.SPEND ? context.userWalletId : context.treasuryWalletId;
    const destinationWalletId =
      type === TransactionType.SPEND ? context.treasuryWalletId : context.userWalletId;

    const distributedLock = await distributedLockService.acquireWalletLocks([
      sourceWalletId,
      destinationWalletId
    ]);

    try {
      const result = await prisma.$transaction(
        async (tx) => {
          const idempotencyRecord = await this.createOrReplayTransaction(tx, {
            type,
            input,
            assetTypeId: context.assetTypeId,
            sourceWalletId,
            destinationWalletId
          });

          if (idempotencyRecord.replay) {
            return idempotencyRecord.result;
          }

          const lockedWallets = await this.lockWallets(tx, [sourceWalletId, destinationWalletId]);
          const expectedWalletIds = sortUniqueWalletIds([sourceWalletId, destinationWalletId]);

          if (lockedWallets.length !== expectedWalletIds.length) {
            throw new AppError(
              409,
              "LOCKED_WALLET_MISMATCH",
              "Wallet set changed during transaction. Retry request."
            );
          }

          const sourceBalance = await this.getWalletBalance(tx, sourceWalletId, context.assetTypeId);

          if (sourceBalance < input.amount) {
            const body: ErrorPayload = {
              error: {
                code: "INSUFFICIENT_FUNDS",
                message: "Insufficient wallet balance"
              }
            };

            await tx.transaction.update({
              where: { id: idempotencyRecord.transactionId },
              data: {
                status: TransactionStatus.FAILED,
                errorCode: "INSUFFICIENT_FUNDS",
                responseCode: 409,
                responseBody: body as Prisma.InputJsonObject
              }
            });

            return {
              statusCode: 409,
              body,
              replayed: false
            };
          }

          await tx.ledgerEntry.createMany({
            data: [
              {
                transactionId: idempotencyRecord.transactionId,
                walletId: sourceWalletId,
                assetTypeId: context.assetTypeId,
                entryType: EntryType.DEBIT,
                amount: input.amount
              },
              {
                transactionId: idempotencyRecord.transactionId,
                walletId: destinationWalletId,
                assetTypeId: context.assetTypeId,
                entryType: EntryType.CREDIT,
                amount: input.amount
              }
            ]
          });

          await this.bumpWalletVersions(tx, lockedWallets);

          const userBalance = await this.getWalletBalance(tx, context.userWalletId, context.assetTypeId);

          const body: WalletMutationSuccessPayload = {
            transactionId: idempotencyRecord.transactionId,
            idempotencyKey: input.idempotencyKey,
            operation: operationLabel(type),
            userId: input.userId,
            assetCode: context.assetCode,
            amount: input.amount.toString(),
            balance: userBalance.toString(),
            fromWalletId: sourceWalletId,
            toWalletId: destinationWalletId,
            createdAt: idempotencyRecord.createdAt.toISOString()
          };

          await tx.transaction.update({
            where: { id: idempotencyRecord.transactionId },
            data: {
              status: TransactionStatus.POSTED,
              responseCode: 200,
              responseBody: body as Prisma.InputJsonObject
            }
          });

          return {
            statusCode: 200,
            body,
            replayed: false
          };
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
          maxWait: 5000,
          timeout: 10000
        }
      );

      await idempotencyCache.set(input.idempotencyKey, {
        requestFingerprint: input.requestFingerprint,
        statusCode: result.statusCode,
        body: result.body
      });

      return result;
    } finally {
      await distributedLock.release();
    }
  }

  private async resolveContext(userId: string, assetCode: string): Promise<WalletExecutionContext> {
    const normalizedCode = assetCode.toUpperCase();

    const assetType = await prisma.assetType.findUnique({
      where: {
        code: normalizedCode
      }
    });

    if (!assetType) {
      throw new AppError(404, "ASSET_TYPE_NOT_FOUND", `Unknown asset code: ${assetCode}`);
    }

    const userWallet = await prisma.wallet.findFirst({
      where: {
        ownerType: WalletOwnerType.USER,
        userId,
        assetTypeId: assetType.id
      },
      select: {
        id: true
      }
    });

    if (!userWallet) {
      throw new AppError(
        404,
        "USER_WALLET_NOT_FOUND",
        `Wallet for user ${userId} and asset ${assetType.code} does not exist`
      );
    }

    const treasuryWallet = await prisma.wallet.findFirst({
      where: {
        ownerType: WalletOwnerType.SYSTEM,
        systemCode: TREASURY_SYSTEM_CODE,
        assetTypeId: assetType.id
      },
      select: {
        id: true
      }
    });

    if (!treasuryWallet) {
      throw new AppError(
        500,
        "TREASURY_WALLET_NOT_CONFIGURED",
        `Treasury wallet missing for asset ${assetType.code}`
      );
    }

    return {
      assetTypeId: assetType.id,
      assetCode: assetType.code,
      userWalletId: userWallet.id,
      treasuryWalletId: treasuryWallet.id
    };
  }

  private async createOrReplayTransaction(
    tx: Prisma.TransactionClient,
    options: {
      type: TransactionType;
      input: WalletMutationRequest;
      assetTypeId: string;
      sourceWalletId: string;
      destinationWalletId: string;
    }
  ): Promise<
    | {
        replay: false;
        transactionId: string;
        createdAt: Date;
      }
    | {
        replay: true;
        result: WalletMutationResult;
      }
  > {
    try {
      const created = await tx.transaction.create({
        data: {
          idempotencyKey: options.input.idempotencyKey,
          requestHash: options.input.requestFingerprint,
          type: options.type,
          status: TransactionStatus.PROCESSING,
          amount: options.input.amount,
          assetTypeId: options.assetTypeId,
          sourceWalletId: options.sourceWalletId,
          destinationWalletId: options.destinationWalletId
        }
      });

      return {
        replay: false,
        transactionId: created.id,
        createdAt: created.createdAt
      };
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
        throw error;
      }

      const existing = await tx.transaction.findUnique({
        where: {
          idempotencyKey: options.input.idempotencyKey
        }
      });

      if (!existing) {
        throw new AppError(
          500,
          "IDEMPOTENCY_STATE_NOT_FOUND",
          "Failed to load transaction for existing Idempotency-Key"
        );
      }

      if (existing.requestHash !== options.input.requestFingerprint) {
        throw new AppError(
          409,
          "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST",
          "Idempotency-Key has already been used with a different request payload"
        );
      }

      if (existing.responseCode === null || existing.responseBody === null) {
        throw new AppError(
          409,
          "REQUEST_ALREADY_IN_PROGRESS",
          "A request with this Idempotency-Key is currently in progress"
        );
      }

      return {
        replay: true,
        result: {
          statusCode: existing.responseCode,
          body: existing.responseBody as WalletMutationPayload,
          replayed: true
        }
      };
    }
  }

  private async lockWallets(
    tx: Prisma.TransactionClient,
    walletIds: string[]
  ): Promise<Array<{ id: string; version: number }>> {
    const orderedWalletIds = sortUniqueWalletIds(walletIds);
    const walletIdParams = orderedWalletIds.map((walletId) => Prisma.sql`${walletId}::uuid`);

    const rows = await tx.$queryRaw<LockedWalletRow[]>(Prisma.sql`
      SELECT id, version
      FROM wallets
      WHERE id IN (${Prisma.join(walletIdParams)})
      ORDER BY id
      FOR UPDATE
    `);

    return rows.map((row) => ({
      id: row.id,
      version: toNumber(row.version)
    }));
  }

  private async bumpWalletVersions(
    tx: Prisma.TransactionClient,
    lockedWallets: Array<{ id: string; version: number }>
  ): Promise<void> {
    const updates: Array<{ walletId: string; updatedCount: number }> = [];

    for (const wallet of lockedWallets) {
      const updated = await tx.wallet.updateMany({
        where: {
          id: wallet.id,
          version: wallet.version
        },
        data: {
          version: {
            increment: 1
          }
        }
      });

      updates.push({
        walletId: wallet.id,
        updatedCount: updated.count
      });
    }

    assertOptimisticWalletUpdates(updates);
  }

  private async getWalletBalance(
    tx: Prisma.TransactionClient,
    walletId: string,
    assetTypeId: string
  ): Promise<bigint> {
    const rows = await tx.$queryRaw<LedgerBalanceRow[]>(Prisma.sql`
      SELECT COALESCE(
        SUM(CASE WHEN entry_type = 'CREDIT'::"EntryType" THEN amount ELSE -amount END),
        0
      )::bigint AS balance
      FROM ledger_entries
      WHERE wallet_id = ${walletId}::uuid
        AND asset_type_id = ${assetTypeId}::uuid
    `);

    return toBigInt(rows[0]?.balance ?? 0);
  }
}

export const walletService = new WalletService();
