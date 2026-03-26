/**
 * requestLogger.ts — HTTP Request Logging Middleware
 *
 * Logs every incoming HTTP request with method, URL, status code, and response time.
 * Uses pino for structured JSON logging in production.
 * Helps with debugging webhook flows and tracking API performance.
 */

import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';

/** Logs each request with timing information. */
export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - start;
    logger.info(
      {
        method: req.method,
        url: req.originalUrl,
        status: res.statusCode,
        duration: `${duration}ms`,
      },
      `${req.method} ${req.originalUrl} ${res.statusCode} ${duration}ms`
    );
  });

  next();
}
