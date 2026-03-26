/**
 * rateLimiter.ts — Rate Limiting Middleware
 *
 * Provides per-IP rate limiting to protect against abuse.
 * Uses an in-memory store (suitable for single-server deployment).
 * For multi-server production, replace with Redis-backed store.
 *
 * Two tiers:
 * - General API: 100 requests per 15 minutes per IP
 * - Webhook endpoints: 500 requests per 15 minutes per IP (higher because
 *   accept.blue can send bursts during batch settlements)
 */

import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const store = new Map<string, RateLimitEntry>();

// Clean up expired entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (entry.resetAt <= now) store.delete(key);
  }
}, 5 * 60 * 1000);

/** Creates a rate limiter with the given max requests and window. */
function createLimiter(maxRequests: number, windowMs: number) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const ip = req.ip || req.headers['x-forwarded-for'] as string || 'unknown';
    const key = `${ip}:${maxRequests}`;
    const now = Date.now();

    let entry = store.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      store.set(key, entry);
    }

    entry.count++;

    // Set rate limit headers
    res.setHeader('X-RateLimit-Limit', maxRequests);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, maxRequests - entry.count));
    res.setHeader('X-RateLimit-Reset', Math.ceil(entry.resetAt / 1000));

    if (entry.count > maxRequests) {
      logger.warn({ ip, count: entry.count, limit: maxRequests }, 'Rate limit exceeded');
      res.status(429).json({
        error: 'Too many requests',
        retryAfter: Math.ceil((entry.resetAt - now) / 1000),
      });
      return;
    }

    next();
  };
}

/** General API rate limiter: 100 requests per 15 minutes. */
export const apiRateLimiter = createLimiter(100, 15 * 60 * 1000);

/** Webhook rate limiter: 500 requests per 15 minutes (higher for burst events). */
export const webhookRateLimiter = createLimiter(500, 15 * 60 * 1000);
