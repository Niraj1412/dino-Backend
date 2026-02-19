import { NextFunction, Request, Response } from "express";
import { AppError } from "../errors/app-error";
import { idempotencyCache } from "../services/idempotency-cache";
import { buildRequestFingerprint } from "../utils/request-fingerprint";

const getPathWithoutQuery = (request: Request): string => request.originalUrl.split("?")[0] ?? request.originalUrl;

export const requireIdempotency = (
  request: Request,
  response: Response,
  next: NextFunction
): Promise<void> => {
  return (async () => {
    const idempotencyKey = request.header("Idempotency-Key");

    if (!idempotencyKey) {
      throw new AppError(400, "IDEMPOTENCY_KEY_MISSING", "Idempotency-Key header is required");
    }

    const requestFingerprint = buildRequestFingerprint(
      request.method,
      getPathWithoutQuery(request),
      request.body ?? {}
    );

    const cached = await idempotencyCache.get(idempotencyKey);

    if (cached) {
      if (cached.requestFingerprint !== requestFingerprint) {
        throw new AppError(
          409,
          "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST",
          "Idempotency-Key has already been used with a different request payload"
        );
      }

      response.setHeader("Idempotency-Replayed", "true");
      response.status(cached.statusCode).json(cached.body);
      return;
    }

    request.idempotencyKey = idempotencyKey;
    request.requestFingerprint = requestFingerprint;
    next();
  })().catch(next);
};
