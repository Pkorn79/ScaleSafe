import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';

/**
 * Input validation middleware factory.
 * Validates required fields in req.body for POST endpoints.
 */
export function validateBody(rules: Record<string, { required?: boolean; type?: string; minLength?: number; maxLength?: number }>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const errors: string[] = [];

    for (const [field, rule] of Object.entries(rules)) {
      const value = req.body[field];

      if (rule.required && (value === undefined || value === null || value === '')) {
        errors.push(`${field} is required`);
        continue;
      }

      if (value !== undefined && value !== null && value !== '') {
        if (rule.type && typeof value !== rule.type) {
          errors.push(`${field} must be of type ${rule.type}`);
        }
        if (rule.type === 'string' || typeof value === 'string') {
          if (rule.minLength && String(value).length < rule.minLength) {
            errors.push(`${field} must be at least ${rule.minLength} characters`);
          }
          if (rule.maxLength && String(value).length > rule.maxLength) {
            errors.push(`${field} is too long (max ${rule.maxLength} characters)`);
          }
        }
      }
    }

    if (errors.length > 0) {
      logger.warn({ errors, path: req.path }, 'Input validation failed');
      res.status(400).json({ error: errors[0], errors });
      return;
    }

    next();
  };
}

/**
 * Sanitize string inputs — trim whitespace, remove null bytes.
 */
export function sanitizeBody(req: Request, _res: Response, next: NextFunction): void {
  if (req.body && typeof req.body === 'object') {
    for (const [key, value] of Object.entries(req.body)) {
      if (typeof value === 'string') {
        req.body[key] = value.trim().replace(/\0/g, '');
      }
    }
  }
  next();
}
