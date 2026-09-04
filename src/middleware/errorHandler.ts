import { Request, Response, NextFunction } from 'express';
import { AppError } from '../utils/errors';
import { ProcessorError } from '../errors/processor.error';
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

  // Processor/config failures carry merchant-actionable messages ("Reconnect
  // Stripe before continuing") that must not collapse into a generic 500.
  if (err instanceof ProcessorError) {
    logger.warn({ code: err.code, processor: err.processor, path }, err.message);
    res.status(502).json({
      error: err.code || 'PROCESSOR_ERROR',
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
