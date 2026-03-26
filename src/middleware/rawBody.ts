import { Request, Response, NextFunction } from 'express';

/**
 * Preserves the raw request body as a Buffer on req.rawBody.
 * Needed for HMAC webhook signature verification (must hash the exact bytes received).
 * Use as the `verify` callback in express.json().
 */
export function captureRawBody(req: Request, _res: Response, buf: Buffer): void {
  req.rawBody = buf;
}
