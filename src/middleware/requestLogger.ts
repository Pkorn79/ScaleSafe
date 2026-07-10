import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';

export function safeRequestPath(path: string): string {
  return path.replace(/(\/webhooks\/connectors\/[^/]+\/)[^/]+/i, '$1[redacted]');
}

export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - start;
    const level = res.statusCode >= 400 ? 'warn' : 'info';
    const path = safeRequestPath(req.path);
    logger[level]({
      method: req.method,
      path,
      status: res.statusCode,
      duration,
      locationId: req.tenantContext?.locationId,
    }, `${req.method} ${path}`);
  });

  next();
}
