/**
 * Launch-critical route test: POST /api/dashboard/manual-sale/charge (chargeManualSale).
 *
 * Money-in path (Quick Manual Sale). The controller is a thin delegator over
 * payFirstEnrollmentService.chargeCardAndCreatePaidEnrollment, so this locks down the
 * invariants the controller itself owns — a silent regression in any of these charges the
 * wrong merchant, charges the wrong amount, or mis-handles a processor decline:
 *  - tenant scoping: no resolvable location -> ValidationError, service is NEVER invoked
 *  - request->service param mapping: amount coercion, ach/card normalization, sendEnrollment default
 *  - successful charge: service result is passed straight through to res.json (shape preserved)
 *  - declined/failed charge: a ProcessorError is translated into a 502 ExternalServiceError
 *  - generic errors propagate unchanged to next() (no swallowing)
 */
import { Request, Response } from 'express';
import { ExternalServiceError, ValidationError } from '../../src/utils/errors';

const mockChargeManualSale = jest.fn();
const mockGetWhopManualSaleStatus = jest.fn();
jest.mock('../../src/services/pay-first-enrollment.service', () => ({
  payFirstEnrollmentService: {
    chargeCardAndCreatePaidEnrollment: (...args: any[]) => mockChargeManualSale(...args),
    getWhopManualSaleStatus: (...args: any[]) => mockGetWhopManualSaleStatus(...args),
  },
}));

let mockLocationId: string | undefined = 'loc-1';
jest.mock('../../src/middleware/tenantContext', () => ({
  resolveLocationId: () => mockLocationId,
}));

import { dashboardController } from '../../src/controllers/dashboard.controller';

function mockReq(body: any = {}, tenantContext?: any): Request {
  return { body, tenantContext } as any;
}

function mockRes(): Response {
  const res: any = {};
  res.json = jest.fn().mockReturnValue(res);
  res.status = jest.fn().mockReturnValue(res);
  return res;
}

const next = jest.fn();

const validBody = {
  email: 'buyer@example.com',
  amount: '149.00',
  paymentToken: 'tok_abc',
  offerId: 'offer-1',
  contactId: 'contact-1',
  firstName: 'Jane',
  lastName: 'Doe',
};

beforeEach(() => {
  jest.clearAllMocks();
  mockLocationId = 'loc-1';
  mockChargeManualSale.mockResolvedValue({ success: true });
  mockGetWhopManualSaleStatus.mockResolvedValue({ success: true, confirmed: false });
});

describe('chargeManualSale', () => {
  it('does not charge when no location can be resolved (tenant scoping)', async () => {
    mockLocationId = undefined;
    const res = mockRes();
    await dashboardController.chargeManualSale(mockReq(validBody), res, next);

    expect(mockChargeManualSale).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0]).toBeInstanceOf(ValidationError);
  });

  it('passes the resolved locationId and coerced/normalized params to the service', async () => {
    const res = mockRes();
    await dashboardController.chargeManualSale(
      mockReq(
        { ...validBody, amount: '149.00', paymentMethod: 'ach' },
        { userId: 'user-9' },
      ),
      res,
      next,
    );

    expect(mockChargeManualSale).toHaveBeenCalledTimes(1);
    const arg = mockChargeManualSale.mock.calls[0][0];
    expect(arg.locationId).toBe('loc-1');
    expect(arg.email).toBe('buyer@example.com');
    // amount string is coerced to a Number before reaching the money path
    expect(arg.amount).toBe(149);
    expect(typeof arg.amount).toBe('number');
    expect(arg.paymentToken).toBe('tok_abc');
    expect(arg.offerId).toBe('offer-1');
    expect(arg.contactId).toBe('contact-1');
    // ach is the only non-card method honored; everything else collapses to 'card'
    expect(arg.paymentMethod).toBe('ach');
    // recordedBy is taken from tenant context, not the request body
    expect(arg.recordedBy).toBe('user-9');
    expect(next).not.toHaveBeenCalled();
  });

  it('defaults paymentMethod to card and sendEnrollment to true', async () => {
    const res = mockRes();
    await dashboardController.chargeManualSale(
      mockReq({ ...validBody, paymentMethod: 'visa' }),
      res,
      next,
    );

    const arg = mockChargeManualSale.mock.calls[0][0];
    expect(arg.paymentMethod).toBe('card');
    // sendEnrollment defaults to true (only an explicit false disables it)
    expect(arg.sendEnrollment).toBe(true);
    expect(arg.recordedBy).toBe('merchant');
  });

  it('honors an explicit sendEnrollment=false', async () => {
    const res = mockRes();
    await dashboardController.chargeManualSale(
      mockReq({ ...validBody, sendEnrollment: false }),
      res,
      next,
    );
    expect(mockChargeManualSale.mock.calls[0][0].sendEnrollment).toBe(false);
  });

  it('passes the successful charge result straight through to res.json', async () => {
    const serviceResult = {
      success: true,
      transactionId: 'txn-123',
      contactId: 'contact-1',
      enrollmentId: 'enr-1',
      processorType: 'nmi',
    };
    mockChargeManualSale.mockResolvedValue(serviceResult);
    const res = mockRes();
    await dashboardController.chargeManualSale(mockReq(validBody), res, next);

    expect(res.json).toHaveBeenCalledTimes(1);
    expect(res.json).toHaveBeenCalledWith(serviceResult);
    expect(next).not.toHaveBeenCalled();
  });

  it('translates a ProcessorError (declined charge) into a 502 ExternalServiceError', async () => {
    const procErr: any = new Error('Card declined');
    procErr.name = 'ProcessorError';
    procErr.processor = 'nmi';
    procErr.code = 'DECLINED';
    mockChargeManualSale.mockRejectedValue(procErr);

    const res = mockRes();
    await dashboardController.chargeManualSale(mockReq(validBody), res, next);

    expect(res.json).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
    const forwarded = next.mock.calls[0][0];
    expect(forwarded).toBeInstanceOf(ExternalServiceError);
    // ExternalServiceError renders as "<service>: <message>"
    expect(forwarded.message).toContain('nmi');
    expect(forwarded.message).toContain('Card declined');
  });

  it('propagates a non-processor error unchanged to next()', async () => {
    const boom = new ValidationError('Offer not found or inactive');
    mockChargeManualSale.mockRejectedValue(boom);

    const res = mockRes();
    await dashboardController.chargeManualSale(mockReq(validBody), res, next);

    expect(res.json).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0]).toBe(boom);
  });
});

describe('getManualSaleWhopStatus', () => {
  it('uses the trusted tenant and route enrollment ID', async () => {
    const res = mockRes();
    const req = { params: { enrollmentId: 'enr_whop_1' } } as any;

    await dashboardController.getManualSaleWhopStatus(req, res, next);

    expect(mockGetWhopManualSaleStatus).toHaveBeenCalledWith('loc-1', 'enr_whop_1');
    expect(res.json).toHaveBeenCalledWith({ success: true, confirmed: false });
    expect(next).not.toHaveBeenCalled();
  });

  it('does not query an enrollment when the tenant cannot be resolved', async () => {
    mockLocationId = undefined;
    const res = mockRes();

    await dashboardController.getManualSaleWhopStatus(
      { params: { enrollmentId: 'enr_whop_1' } } as any,
      res,
      next,
    );

    expect(mockGetWhopManualSaleStatus).not.toHaveBeenCalled();
    expect(next.mock.calls[0][0]).toBeInstanceOf(ValidationError);
  });
});
