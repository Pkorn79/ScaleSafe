/**
 * errorHandler.ts — Global Error Handler Middleware
 *
 * Catches all errors thrown in route handlers and services.
 * Maps AppError subclasses to proper HTTP status codes.
 * In production, never leaks internal error details to the client.
 * In development, includes the stack trace for debugging.
 */

import { Request, Response, NextFunction } from 'express';
import { AppError } from '../utils/errors';
import { logger } from '../utils/logger';

/** Express error-handling middleware (must have 4 parameters). */
export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  // If it's one of our known error types, use its status code
  if (err instanceof AppError) {
    logger.warn({ err, statusCode: err.statusCode }, err.message);
    res.status(err.statusCode).json({
      error: err.message,
      statusCode: err.statusCode,
    });
    return;
  }

  // Unknown/unexpected error — log the full details, return 500
  logger.error({ err }, 'Unhandled error');
  const isProduction = process.env.NODE_ENV === 'production';
  res.status(500).json({
    error: isProduction ? 'Internal server error' : err.message,
    statusCode: 500,
    ...(isProduction ? {} : { stack: err.stack }),
  });
}
