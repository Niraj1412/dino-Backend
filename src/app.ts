import express from "express";
import pinoHttp from "pino-http";
import { randomUUID } from "crypto";
import type { RequestHandler } from "express";
import { logger } from "./config/logger";
import { errorHandler } from "./middleware/error-handler";
import { notFoundHandler } from "./middleware/not-found";
import { requestLoggingMiddleware } from "./middleware/request-logging";
import { healthRoutes } from "./routes/health-routes";
import { walletRoutes } from "./routes/wallet-routes";

export const app = express();

app.use(
  pinoHttp({
    logger,
    autoLogging: false,
    genReqId: (request, response) => {
      const requestId = request.headers["x-request-id"];

      if (typeof requestId === "string" && requestId.length > 0) {
        response.setHeader("x-request-id", requestId);
        return requestId;
      }

      const generated = randomUUID();
      response.setHeader("x-request-id", generated);
      return generated;
    },
    customLogLevel: (_request, response, error) => {
      if (error || response.statusCode >= 500) {
        return "error";
      }

      if (response.statusCode >= 400) {
        return "warn";
      }

      return "info";
    }
  })
);

app.use(express.json({ limit: "1mb" }) as RequestHandler);
app.use(requestLoggingMiddleware);

app.use("/health", healthRoutes);
app.use("/wallet", walletRoutes);

app.use(notFoundHandler);
app.use(errorHandler);
