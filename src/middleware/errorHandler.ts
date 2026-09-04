import { Request, Response, NextFunction } from 'express';
import { AppError } from '../utils/errors';
import { ProcessorError } from '../errors/processor.error';
import { logger } from '../utils/logger';
import { safeRequestPath } from './requestLogger';

const SAFE_PROCESSOR_MESSAGES = new Set([
  'STRIPE_MODE_NOT_CONFIGURED',
  'STRIPE_CONNECTION_MODE_UNKNOWN',
  'STRIPE_CONNECTION_MODE_MISMATCH',
  'STRIPE_CONNECTION_NOT_FOUND',
  'OAUTH_MODE_MISMATCH',
]);

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

  // Surface only reviewed configuration messages. Processor errors can contain
  // raw provider text and must otherwise remain behind a generic response.
  if (err instanceof ProcessorError) {
    logger.warn({ code: err.code, processor: err.processor, path }, err.message);
    const code = SAFE_PROCESSOR_MESSAGES.has(String(err.code || ''))
      ? String(err.code)
      : 'PROCESSOR_ERROR';
    res.status(502).json({
      error: code,
      message: code === 'PROCESSOR_ERROR'
        ? 'The payment processor request could not be completed.'
        : err.message,
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
