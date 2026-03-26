import { Request, Response, NextFunction } from 'express';
import { ValidationError } from '../utils/errors';

/**
 * Ensures tenantContext is present on the request.
 * Use after ssoAuth middleware on routes that require a known merchant.
 */
export function requireTenant(req: Request, _res: Response, next: NextFunction): void {
  if (!req.tenantContext?.locationId) {
    return next(new ValidationError('Tenant context required (locationId missing)'));
  }
  next();
}

/**
 * Extract locationId from params or tenant context.
 * For API routes that accept :locationId in the URL, falls back to SSO context.
 */
export function resolveLocationId(req: Request): string {
  return req.params.locationId || req.tenantContext?.locationId || '';
}
