import 'express';

declare module 'express' {
  interface Request {
    /** Populated by SSO auth middleware for GHL-embedded requests */
    tenantContext?: {
      locationId: string;
      companyId: string;
      userId: string;
      email: string;
      role: string;
    };
    /** Raw body buffer preserved for webhook signature verification */
    rawBody?: Buffer;
  }
}
