/**
 * errorHandler mapping: ProcessorError must surface its real message and code
 * instead of collapsing into a generic 500 INTERNAL_ERROR.
 *
 * Live incident (2026-09-03, PMG): STRIPE_CONNECTION_MODE_MISMATCH thrown by
 * assertStripeProcessorConfigMode reached merchants as "An unexpected error
 * occurred" because ProcessorError does not extend AppError.
 */

jest.mock('../../src/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import { errorHandler } from '../../src/middleware/errorHandler';
import { ProcessorError } from '../../src/errors/processor.error';
import { ValidationError } from '../../src/utils/errors';

function makeRes() {
  const res: any = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
}
const req: any = { path: '/api/payments/lifecycle/enrollment/status', method: 'POST' };

describe('errorHandler', () => {
  it('maps ProcessorError to a 502 with its code and real message', () => {
    const res = makeRes();
    const err = new ProcessorError(
      'This is a test Stripe connection, but ScaleSafe is running in live mode. Reconnect Stripe before continuing.',
      'stripe',
      'STRIPE_CONNECTION_MODE_MISMATCH',
    );

    errorHandler(err, req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(502);
    expect(res.json).toHaveBeenCalledWith({
      error: 'STRIPE_CONNECTION_MODE_MISMATCH',
      message: 'This is a test Stripe connection, but ScaleSafe is running in live mode. Reconnect Stripe before continuing.',
    });
  });

  it('hides unreviewed processor detail behind a generic response', () => {
    const res = makeRes();
    errorHandler(new ProcessorError('NMI is unreachable', 'nmi'), req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(502);
    expect(res.json).toHaveBeenCalledWith({
      error: 'PROCESSOR_ERROR',
      message: 'The payment processor request could not be completed.',
    });
  });

  it('still maps AppError subclasses to their own status codes', () => {
    const res = makeRes();
    errorHandler(new ValidationError('enrollmentId required'), req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: 'VALIDATION_ERROR',
      message: 'enrollmentId required',
    });
  });

  it('still hides unexpected errors behind a generic 500', () => {
    const res = makeRes();
    errorHandler(new Error('supabase timeout: connection reset'), req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      error: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
    });
  });
});
