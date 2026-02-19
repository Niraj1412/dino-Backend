import { NextFunction, Request, Response } from "express";

export const asyncHandler =
  <TRequest extends Request = Request>(
    handler: (req: TRequest, res: Response, next: NextFunction) => Promise<void>
  ) =>
  (req: Request, res: Response, next: NextFunction): void => {
    void handler(req as TRequest, res, next).catch(next);
  };