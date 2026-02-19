import { Router } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";
import { redis } from "../db/redis";
import { asyncHandler } from "../utils/async-handler";

const router = Router();

router.get(
  "/",
  asyncHandler(async (_request, response) => {
    response.status(200).json({
      status: "ok",
      checks: {
        liveness: "ok"
      },
      timestamp: new Date().toISOString()
    });
  })
);

router.get(
  "/live",
  asyncHandler(async (_request, response) => {
    response.status(200).json({
      status: "ok",
      service: "wallet-service",
      timestamp: new Date().toISOString()
    });
  })
);

router.get(
  "/ready",
  asyncHandler(async (_request, response) => {
    const checks = {
      postgres: "down",
      redis: "down"
    };

    let statusCode = 200;

    try {
      await prisma.$queryRaw(Prisma.sql`SELECT 1`);
      checks.postgres = "up";
    } catch {
      statusCode = 503;
    }

    try {
      if (redis.status === "wait") {
        await redis.connect();
      }

      const result = await redis.ping();
      checks.redis = result === "PONG" ? "up" : "down";

      if (checks.redis === "down") {
        statusCode = 503;
      }
    } catch {
      statusCode = 503;
    }

    response.status(statusCode).json({
      status: statusCode === 200 ? "ready" : "not_ready",
      checks,
      timestamp: new Date().toISOString()
    });
  })
);

export const healthRoutes = router;
