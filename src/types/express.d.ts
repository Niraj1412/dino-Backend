import type { Request } from "express";
import type { Logger } from "pino";

declare module "express-serve-static-core" {
  interface Request {
    id?: string;
    log?: Logger;
    idempotencyKey?: string;
    requestFingerprint?: string;
  }
}

export type TypedRequest = Request;
