import { NextFunction, Request, Response } from "express";

export const notFoundHandler = (request: Request, response: Response, _next: NextFunction): void => {
  response.status(404).json({
    error: {
      code: "ROUTE_NOT_FOUND",
      message: `No route found for ${request.method} ${request.originalUrl}`
    }
  });
};