import { Router } from "express";
import { z } from "zod";
import { AppError } from "../errors/app-error";
import { requireIdempotency } from "../middleware/idempotency";
import { validate } from "../middleware/validate";
import { walletService } from "../services/wallet-service";
import { asyncHandler } from "../utils/async-handler";

const router = Router();

const positiveAmountSchema = z
  .union([z.string(), z.number(), z.bigint()])
  .transform((value, context) => {
    try {
      const amount = BigInt(value);

      if (amount <= 0n) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "amount must be greater than zero"
        });

        return z.NEVER;
      }

      return amount;
    } catch {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "amount must be a valid integer"
      });

      return z.NEVER;
    }
  });

const walletMutationSchema = z
  .object({
  userId: z.string().uuid(),
  assetCode: z
    .string()
    .trim()
    .min(1)
    .max(50)
    .transform((value) => value.toUpperCase()),
  amount: positiveAmountSchema
  })
  .strict();

const balanceParamsSchema = z
  .object({
  userId: z.string().uuid()
  })
  .strict();

const balanceQuerySchema = z
  .object({
  assetCode: z
    .string()
    .trim()
    .min(1)
    .max(50)
    .transform((value) => value.toUpperCase())
    .optional()
  })
  .strict();

const buildMutationInput = (
  idempotencyKey: string | undefined,
  requestFingerprint: string | undefined,
  body: z.infer<typeof walletMutationSchema>
) => {
  if (!idempotencyKey || !requestFingerprint) {
    throw new AppError(
      500,
      "IDEMPOTENCY_CONTEXT_MISSING",
      "Idempotency middleware context is missing"
    );
  }

  return {
    userId: body.userId,
    assetCode: body.assetCode,
    amount: body.amount,
    idempotencyKey,
    requestFingerprint
  };
};

router.post(
  "/topup",
  requireIdempotency,
  validate(walletMutationSchema, "body"),
  asyncHandler(async (request, response) => {
    const payload = request.body as z.infer<typeof walletMutationSchema>;

    const result = await walletService.topup(
      buildMutationInput(request.idempotencyKey, request.requestFingerprint, payload)
    );

    if (result.replayed) {
      response.setHeader("Idempotency-Replayed", "true");
    }

    response.status(result.statusCode).json(result.body);
  })
);

router.post(
  "/bonus",
  requireIdempotency,
  validate(walletMutationSchema, "body"),
  asyncHandler(async (request, response) => {
    const payload = request.body as z.infer<typeof walletMutationSchema>;

    const result = await walletService.bonus(
      buildMutationInput(request.idempotencyKey, request.requestFingerprint, payload)
    );

    if (result.replayed) {
      response.setHeader("Idempotency-Replayed", "true");
    }

    response.status(result.statusCode).json(result.body);
  })
);

router.post(
  "/spend",
  requireIdempotency,
  validate(walletMutationSchema, "body"),
  asyncHandler(async (request, response) => {
    const payload = request.body as z.infer<typeof walletMutationSchema>;

    const result = await walletService.spend(
      buildMutationInput(request.idempotencyKey, request.requestFingerprint, payload)
    );

    if (result.replayed) {
      response.setHeader("Idempotency-Replayed", "true");
    }

    response.status(result.statusCode).json(result.body);
  })
);

router.get(
  "/:userId/balance",
  validate(balanceParamsSchema, "params"),
  validate(balanceQuerySchema, "query"),
  asyncHandler(async (request, response) => {
    const params = request.params as z.infer<typeof balanceParamsSchema>;
    const query = request.query as z.infer<typeof balanceQuerySchema>;

    const result = await walletService.getBalance(params.userId, query.assetCode);
    response.status(200).json(result);
  })
);

export const walletRoutes = router;
