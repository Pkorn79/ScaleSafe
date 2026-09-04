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
    /** Populated only by the isolated ScaleSafe operator session middleware. */
    operatorContext?: import('./operator.types').OperatorContext;
    /** Stable request identifier used for operator audit correlation. */
    operatorRequestId?: string;
    /** Raw body buffer preserved for webhook signature verification */
    rawBody?: Buffer;
  }
}
