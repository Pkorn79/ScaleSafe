/**
 * Launch-critical route test: offer.controller create / update / clone.
 *
 * The offer controller is a thin delegation layer over offerService. It exists
 * to (a) resolve and enforce tenant scope (location_id) on every call, (b) do
 * minimal request validation, and (c) shape the HTTP response. These tests lock
 * down those invariants:
 *  - create: rejects a body with no offerName (validation -> next(err)), and on
 *    success delegates to offerService.create WITH the resolved location_id and
 *    responds 201 with the created offer.
 *  - update: delegates to offerService.update with (id, locationId, body) and
 *    responds 200; a service error is forwarded to next() (not swallowed).
 *  - clone: delegates to offerService.cloneOffer(id, locationId), responds 201,
 *    and returns the newly-created offer in the wrapped success envelope.
 *
 * The controller forwards thrown errors to next(err); it does not set status
 * codes for failures itself. So failure assertions check next(), not res.status.
 */
import { Request, Response, NextFunction } from 'express';

const mockResolveLocationId = jest.fn();
jest.mock('../../src/middleware/tenantContext', () => ({
  resolveLocationId: (...args: any[]) => mockResolveLocationId(...args),
}));

const mockCreate = jest.fn();
const mockUpdate = jest.fn();
const mockCloneOffer = jest.fn();
jest.mock('../../src/services/offer.service', () => ({
  offerService: {
    create: (...args: any[]) => mockCreate(...args),
    update: (...args: any[]) => mockUpdate(...args),
    cloneOffer: (...args: any[]) => mockCloneOffer(...args),
  },
}));

// Controller also imports these modules at the top; stub them so importing the
// controller doesn't drag in real clients/config.
jest.mock('../../src/services/merchant.service', () => ({ merchantService: {} }));
jest.mock('../../src/services/dual-pricing.service', () => ({ dualPricingService: {} }));
jest.mock('../../src/config', () => ({ config: { appUrl: 'https://app.test' } }));
jest.mock('../../src/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import { offerController } from '../../src/controllers/offer.controller';

function mockReq(body: any = {}, params: any = {}): Request {
  return { body, params } as any;
}

function mockRes(): Response {
  const res: any = {};
  res.json = jest.fn().mockReturnValue(res);
  res.status = jest.fn().mockReturnValue(res);
  res.end = jest.fn().mockReturnValue(res);
  return res;
}

let next: NextFunction & jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  mockResolveLocationId.mockReturnValue('loc-1');
  next = jest.fn() as any;
});

describe('offerController.create', () => {
  it('forwards a ValidationError to next() when offerName is missing (no service call)', async () => {
    const res = mockRes();
    await offerController.create(mockReq({ price: 100 }), res, next);

    expect(next).toHaveBeenCalledTimes(1);
    const err = next.mock.calls[0][0];
    expect(err).toBeInstanceOf(Error);
    expect((err as any).statusCode).toBe(400);
    expect(mockCreate).not.toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('forwards a ValidationError to next() when locationId cannot be resolved', async () => {
    mockResolveLocationId.mockReturnValueOnce(undefined);
    const res = mockRes();
    await offerController.create(mockReq({ offerName: 'Coaching' }), res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect((next.mock.calls[0][0] as any).statusCode).toBe(400);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('delegates to offerService.create with the resolved location_id and responds 201', async () => {
    const created = { id: 'offer-1', offer_name: 'Coaching', location_id: 'loc-1' };
    mockCreate.mockResolvedValueOnce(created);
    const res = mockRes();

    await offerController.create(
      mockReq({ offerName: 'Coaching', price: 6000, paymentType: 'one_time' }),
      res,
      next,
    );

    // location_id (as `locationId`) must be injected into the service payload —
    // tenant scoping is the whole point of this controller.
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ locationId: 'loc-1', offerName: 'Coaching', price: 6000 }),
    );
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(created);
    expect(next).not.toHaveBeenCalled();
  });

  it('does not let a body location override the authenticated tenant', async () => {
    const created = { id: 'offer-1', offer_name: 'Coaching', location_id: 'loc-1' };
    mockCreate.mockResolvedValueOnce(created);
    const res = mockRes();

    await offerController.create(
      mockReq({ offerName: 'Coaching', locationId: 'loc-victim' }),
      res,
      next,
    );

    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({
      offerName: 'Coaching',
      locationId: 'loc-1',
    }));
  });
});

describe('offerController.update', () => {
  it('delegates to offerService.update with (id, locationId, body) and responds 200', async () => {
    const updated = { id: 'offer-1', offer_name: 'Renamed' };
    mockUpdate.mockResolvedValueOnce(updated);
    const res = mockRes();

    await offerController.update(
      mockReq({ offerName: 'Renamed' }, { id: 'offer-1' }),
      res,
      next,
    );

    expect(mockUpdate).toHaveBeenCalledWith('offer-1', 'loc-1', { offerName: 'Renamed' });
    expect(res.json).toHaveBeenCalledWith(updated);
    expect(res.status).not.toHaveBeenCalled(); // plain 200 via res.json, no explicit status
    expect(next).not.toHaveBeenCalled();
  });

  it('forwards a service error to next() (e.g. not found) without writing a response', async () => {
    const boom = Object.assign(new Error('Offer not found'), { statusCode: 404 });
    mockUpdate.mockRejectedValueOnce(boom);
    const res = mockRes();

    await offerController.update(
      mockReq({ offerName: 'Renamed' }, { id: 'missing' }),
      res,
      next,
    );

    expect(next).toHaveBeenCalledWith(boom);
    expect(res.json).not.toHaveBeenCalled();
  });
});

describe('offerController.clone', () => {
  it('delegates to offerService.cloneOffer(id, locationId) and returns the new offer (201)', async () => {
    const clone = { id: 'offer-2', offer_name: 'Coaching (Copy)', active: false };
    mockCloneOffer.mockResolvedValueOnce(clone);
    const res = mockRes();

    await offerController.clone(mockReq({}, { id: 'offer-src' }), res, next);

    expect(mockCloneOffer).toHaveBeenCalledWith('offer-src', 'loc-1');
    expect(res.status).toHaveBeenCalledWith(201);

    const body = (res.json as jest.Mock).mock.calls[0][0];
    expect(body.success).toBe(true);
    expect(body.offer).toEqual(clone); // the duplicated offer is returned to the caller
    expect(typeof body.message).toBe('string');
    expect(next).not.toHaveBeenCalled();
  });

  it('forwards a clone failure to next()', async () => {
    const boom = new Error('clone failed');
    mockCloneOffer.mockRejectedValueOnce(boom);
    const res = mockRes();

    await offerController.clone(mockReq({}, { id: 'offer-src' }), res, next);

    expect(next).toHaveBeenCalledWith(boom);
    expect(res.json).not.toHaveBeenCalled();
  });
});
