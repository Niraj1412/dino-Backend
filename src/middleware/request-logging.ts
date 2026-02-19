import type { NextFunction, Request, Response } from "express";
import { logger } from "../config/logger";

const getHeader = (request: Request, headerName: string): string | undefined => {
  const value = request.header(headerName);

  if (!value) {
    return undefined;
  }

  return value;
};

export const requestLoggingMiddleware = (
  request: Request,
  response: Response,
  next: NextFunction
): void => {
  const requestLogger = request.log ?? logger;
  const startedAt = process.hrtime.bigint();
  const bodyKeys =
    request.body && typeof request.body === "object" && !Array.isArray(request.body)
      ? Object.keys(request.body)
      : [];

  requestLogger.info(
    {
      requestId: request.id ?? null,
      event: "request.received",
      method: request.method,
      path: request.originalUrl,
      idempotencyKey: getHeader(request, "Idempotency-Key"),
      bodyKeys
    },
    "request received"
  );

  response.on("finish", () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;

    requestLogger.info(
      {
        requestId: request.id ?? null,
        event: "request.completed",
        method: request.method,
        path: request.originalUrl,
        statusCode: response.statusCode,
        durationMs: Number(durationMs.toFixed(2))
      },
      "request completed"
    );
  });

  next();
};
