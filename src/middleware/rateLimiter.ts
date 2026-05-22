import { Request, Response, NextFunction } from 'express';

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

function createLimiter(maxRequests: number, windowMs: number) {
  const store = new Map<string, RateLimitEntry>();

  // Cleanup expired entries every 5 minutes
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of store) {
      if (entry.resetAt <= now) store.delete(key);
    }
  }, 5 * 60 * 1000).unref();

  return (req: Request, res: Response, next: NextFunction): void => {
    const key = req.ip || 'unknown';
    const now = Date.now();
    let entry = store.get(key);

    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      store.set(key, entry);
    }

    entry.count++;

    res.setHeader('X-RateLimit-Limit', maxRequests);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, maxRequests - entry.count));
    res.setHeader('X-RateLimit-Reset', Math.ceil(entry.resetAt / 1000));

    if (entry.count > maxRequests) {
      res.status(429).json({ error: 'RATE_LIMITED', message: 'Too many requests' });
      return;
    }

    next();
  };
}

/** API routes: 100 requests per 15 minutes */
export const apiLimiter = createLimiter(100, 15 * 60 * 1000);

/** Webhook routes: 500 requests per 15 minutes */
export const webhookLimiter = createLimiter(500, 15 * 60 * 1000);

/** Checkout endpoints: 10 payment attempts per minute per IP */
export const checkoutLimiter = createLimiter(10, 1 * 60 * 1000);

/** Public enrollment widget endpoints: 100 requests per minute per IP */
export const enrollmentPublicLimiter = createLimiter(100, 1 * 60 * 1000);

/** Debug/admin diagnostics: strict limit because these are token-protected support tools */
export const debugLimiter = createLimiter(30, 15 * 60 * 1000);
