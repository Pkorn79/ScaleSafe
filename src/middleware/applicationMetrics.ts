import { NextFunction, Request, Response } from 'express';
import { applicationMetricsService } from '../services/application-metrics.service';

export function applicationMetrics(req: Request, res: Response, next: NextFunction): void {
  const startedAt = Date.now();
  res.on('finish', () => {
    applicationMetricsService.recordRequest(req.path, res.statusCode, Date.now() - startedAt);
  });
  next();
}

