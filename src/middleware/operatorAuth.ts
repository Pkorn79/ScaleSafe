import crypto from 'crypto';
import { NextFunction, Request, Response } from 'express';
import { config } from '../config';
import { operatorAuthorizationService } from '../services/operator-authorization.service';
import { OperatorPermission } from '../types/operator.types';
import { logger } from '../utils/logger';
import {
  OPERATOR_CSRF_COOKIE,
  OPERATOR_SESSION_COOKIE,
  parseCookies,
} from '../utils/operator-cookies';
import { safeOperatorValueEqual } from '../utils/operator-security';

function operatorConfig(): typeof config.operator | undefined {
  return (config as any).operator;
}

function rawHostname(req: Request): string {
  const host = String(req.headers.host || '').trim().toLowerCase();
  if (host.startsWith('[')) return host.slice(0, host.indexOf(']') + 1);
  return host.split(':')[0];
}

async function auditDenial(req: Request, input: {
  action: string;
  reason: string;
  targetLocationId?: string;
  actor?: {
    operatorUserId?: string;
    organizationId?: string;
    sessionId?: string;
    role?: any;
  };
}): Promise<void> {
  try {
    await operatorAuthorizationService.auditRequest(req, {
      actorOperatorUserId: input.actor?.operatorUserId,
      actorOrganizationId: input.actor?.organizationId,
      actorSessionId: input.actor?.sessionId,
      actorRole: input.actor?.role,
      action: input.action,
      result: 'denied',
      targetLocationId: input.targetLocationId,
      metadata: { reason: input.reason },
    });
  } catch (err) {
    logger.error({ err, action: input.action }, 'Operator denial audit failed');
  }
}

export function operatorFeatureAndHost(req: Request, res: Response, next: NextFunction): void {
  const operator = operatorConfig();
  if (!operator?.enabled || rawHostname(req) !== operator.host) {
    res.status(404).json({ error: 'NOT_FOUND', message: 'Not found' });
    return;
  }

  req.operatorRequestId = crypto.randomUUID();
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data:",
    "connect-src 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
  ].join('; '));

  const carriesMerchantIdentity = Boolean(
    req.headers['x-sso-payload']
    || req.headers['x-location-id']
    || req.query.sso_key
    || req.query.ssoKey,
  );
  if (carriesMerchantIdentity) {
    void auditDenial(req, { action: 'operator.identity_plane.mixed', reason: 'merchant_identity_present' });
    res.status(400).json({ error: 'MIXED_IDENTITY_PLANES', message: 'Invalid authentication context' });
    return;
  }

  next();
}

export function requireOperatorAuthEnabled(_req: Request, res: Response, next: NextFunction): void {
  if (!operatorConfig()?.authEnabled) {
    res.status(404).json({ error: 'NOT_FOUND', message: 'Not found' });
    return;
  }
  next();
}

export function requireOperatorOrigin(req: Request, res: Response, next: NextFunction): void {
  const expected = operatorConfig()?.origin;
  const supplied = String(req.headers.origin || '');
  if (!expected || supplied !== expected) {
    void auditDenial(req, { action: 'operator.origin.denied', reason: 'origin_mismatch' });
    res.status(403).json({ error: 'FORBIDDEN', message: 'Access denied' });
    return;
  }
  next();
}

export async function requireOperatorSession(req: Request, res: Response, next: NextFunction): Promise<void> {
  const token = parseCookies(req)[OPERATOR_SESSION_COOKIE] || '';
  if (!token) {
    await auditDenial(req, { action: 'operator.session.authenticate', reason: 'session_cookie_missing' });
    res.status(401).json({ error: 'AUTHENTICATION_ERROR', message: 'Authentication required' });
    return;
  }

  try {
    const resolution = await operatorAuthorizationService.resolveSessionToken(token);
    if (!resolution.context) {
      await auditDenial(req, {
        action: 'operator.session.authenticate',
        reason: resolution.denialReason || 'session_invalid',
        actor: resolution.actor,
      });
      res.status(401).json({ error: 'AUTHENTICATION_ERROR', message: 'Authentication required' });
      return;
    }
    req.operatorContext = resolution.context;
    next();
  } catch (err) {
    logger.error({ err }, 'Operator session resolution failed');
    await auditDenial(req, { action: 'operator.session.authenticate', reason: 'authorization_dependency_failed' });
    res.status(503).json({ error: 'SERVICE_UNAVAILABLE', message: 'Operator authentication is temporarily unavailable' });
  }
}

export function requireOperatorCsrf(req: Request, res: Response, next: NextFunction): void {
  const context = req.operatorContext;
  const cookies = parseCookies(req);
  const cookieToken = cookies[OPERATOR_CSRF_COOKIE] || '';
  const headerToken = String(req.headers['x-csrf-token'] || '');
  const samePresentedValue = cookieToken.length === headerToken.length
    && cookieToken.length > 0
    && crypto.timingSafeEqual(Buffer.from(cookieToken), Buffer.from(headerToken));
  if (!context || !samePresentedValue || !safeOperatorValueEqual(context.csrfTokenHash, headerToken)) {
    void auditDenial(req, {
      action: 'operator.csrf.denied',
      reason: 'csrf_mismatch',
      actor: context ? {
        operatorUserId: context.operatorUserId,
        organizationId: context.organizationId,
        sessionId: context.sessionId,
        role: context.role,
      } : undefined,
    });
    res.status(403).json({ error: 'FORBIDDEN', message: 'Access denied' });
    return;
  }
  next();
}

export function requireOperatorPermission(permission: OperatorPermission, options: {
  locationParam?: string;
  sensitiveRead?: boolean;
} = {}) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const context = req.operatorContext;
    const locationId = options.locationParam ? String(req.params[options.locationParam] || '') : undefined;
    const actor = context ? {
      operatorUserId: context.operatorUserId,
      organizationId: context.organizationId,
      sessionId: context.sessionId,
      role: context.role,
    } : undefined;

    if (!context || !operatorAuthorizationService.hasPermission(context, permission)) {
      await auditDenial(req, { action: permission, reason: 'permission_denied', targetLocationId: locationId, actor });
      res.status(locationId ? 404 : 403).json({
        error: locationId ? 'NOT_FOUND' : 'FORBIDDEN',
        message: locationId ? 'Resource not found' : 'Access denied',
      });
      return;
    }

    if (locationId && !operatorAuthorizationService.canAccessLocation(context, locationId)) {
      await auditDenial(req, { action: permission, reason: 'location_not_allowed', targetLocationId: locationId, actor });
      res.status(404).json({ error: 'NOT_FOUND', message: 'Resource not found' });
      return;
    }

    if (options.sensitiveRead) {
      try {
        await operatorAuthorizationService.auditRequest(req, {
          actorOperatorUserId: context.operatorUserId,
          actorOrganizationId: context.organizationId,
          actorRole: context.role,
          actorSessionId: context.sessionId,
          action: permission,
          result: 'allowed',
          targetLocationId: locationId,
        });
      } catch (err) {
        logger.error({ err, permission }, 'Operator sensitive-read audit failed');
        res.status(503).json({ error: 'SERVICE_UNAVAILABLE', message: 'Audit service unavailable' });
        return;
      }
    }

    next();
  };
}
