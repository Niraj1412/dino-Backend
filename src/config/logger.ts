import pino from "pino";
import { env } from "./env";

export const logger = pino({
  level: env.nodeEnv === "production" ? "info" : "debug",
  base: {
    service: "wallet-service"
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: ["req.headers.authorization"],
    remove: true
  },
  formatters: {
    level: (label) => ({ level: label })
  }
});
