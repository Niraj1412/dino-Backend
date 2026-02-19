import { app } from "./app";
import { env } from "./config/env";
import { logger } from "./config/logger";
import { prisma } from "./db/prisma";
import { redis } from "./db/redis";

const shutdown = async (signal: string): Promise<void> => {
  logger.info({ signal }, "Shutting down wallet service");

  await Promise.allSettled([
    prisma.$disconnect(),
    redis.status === "ready" ? redis.quit() : Promise.resolve("redis-not-connected")
  ]);

  process.exit(0);
};

const start = async (): Promise<void> => {
  await prisma.$connect();

  if (redis.status === "wait") {
    await redis.connect();
  }

  app.listen(env.port, () => {
    logger.info({ port: env.port }, "Wallet service started");
  });
};

void start().catch((error) => {
  logger.error({ error }, "Failed to start wallet service");
  process.exit(1);
});

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});