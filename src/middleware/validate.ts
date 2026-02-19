import type { NextFunction, Request, Response } from "express";
import type { ZodTypeAny } from "zod";

export const validate =
  <TSchema extends ZodTypeAny>(schema: TSchema, source: "body" | "params" | "query") =>
  (request: Request, _response: Response, next: NextFunction): void => {
    const parsed = schema.parse(request[source]);
    (request as unknown as Record<string, unknown>)[source] = parsed;
    next();
  };
