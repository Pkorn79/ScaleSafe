import { Request, Response, NextFunction } from 'express';
import { AppError } from '../utils/errors';
import { logger } from '../utils/logger';

export function errorHandler(err: Error, req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof AppError) {
    logger.warn({ code: err.code, status: err.statusCode, path: req.path }, err.message);
    res.status(err.statusCode).json({
      error: err.code,
      message: err.message,
    });
    return;
  }

  // Unexpected errors
  logger.error({ err, path: req.path, method: req.method }, 'Unhandled error');
  res.status(500).json({
    error: 'INTERNAL_ERROR',
    message: 'An unexpected error occurred',
  });
}
