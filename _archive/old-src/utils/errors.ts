/**
 * errors.ts — Custom Error Classes
 *
 * Defines error types used throughout the app. Each maps to an HTTP status code.
 * The global error handler in middleware/errorHandler.ts catches these and returns
 * the appropriate HTTP response.
 *
 * Usage: throw new NotFoundError('Contact not found')
 */

/** Base error class for all ScaleSafe errors. */
export class AppError extends Error {
  public readonly statusCode: number;
  public readonly isOperational: boolean;

  constructor(message: string, statusCode: number, isOperational = true) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** 400 — The request was malformed or missing required fields. */
export class BadRequestError extends AppError {
  constructor(message = 'Bad request') {
    super(message, 400);
  }
}

/** 401 — Authentication failed (bad token, bad signature, etc.). */
export class AuthenticationError extends AppError {
  constructor(message = 'Authentication failed') {
    super(message, 401);
  }
}

/** 403 — You don't have permission to access this resource. */
export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden') {
    super(message, 403);
  }
}

/** 404 — The requested resource doesn't exist. */
export class NotFoundError extends AppError {
  constructor(message = 'Not found') {
    super(message, 404);
  }
}

/** 409 — Conflict, like trying to create something that already exists. */
export class ConflictError extends AppError {
  constructor(message = 'Conflict') {
    super(message, 409);
  }
}

/** 401 — Specifically for webhook signature verification failures. */
export class WebhookVerificationError extends AppError {
  constructor(message = 'Webhook signature verification failed') {
    super(message, 401);
  }
}

/** 502 — An external service (GHL, accept.blue, Supabase) returned an error. */
export class ExternalServiceError extends AppError {
  constructor(service: string, message: string) {
    super(`${service}: ${message}`, 502);
  }
}
