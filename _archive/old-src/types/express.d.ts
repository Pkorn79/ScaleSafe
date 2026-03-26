/**
 * express.d.ts — Express Request Type Augmentation
 *
 * Extends the Express Request type with ScaleSafe-specific properties:
 * - tenantContext: SSO-derived merchant/user info (locationId, companyId, etc.)
 * - rawBody: Preserved raw request body buffer for webhook HMAC verification
 */

declare namespace Express {
  interface Request {
    tenantContext?: {
      locationId: string;
      companyId?: string;
      userId?: string;
      email?: string;
      role?: string;
    };
    rawBody?: Buffer;
  }
}
