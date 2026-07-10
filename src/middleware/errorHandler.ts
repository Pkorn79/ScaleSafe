import { Request, Response, NextFunction } from 'express';
import { AppError } from '../utils/errors';
import { logger } from '../utils/logger';
import { safeRequestPath } from './requestLogger';

export function errorHandler(err: Error, req: Request, res: Response, _next: NextFunction): void {
  const path = safeRequestPath(req.path);
  if (err instanceof AppError) {
    logger.warn({ code: err.code, status: err.statusCode, path }, err.message);
    res.status(err.statusCode).json({
      error: err.code,
      message: err.message,
    });
    return;
  }

  // Unexpected errors
  logger.error({ err, path, method: req.method }, 'Unhandled error');
  res.status(500).json({
    error: 'INTERNAL_ERROR',
    message: 'An unexpected error occurred',
  });
}
