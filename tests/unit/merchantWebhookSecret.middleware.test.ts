import { requireMerchantWebhookSecret } from '../../src/middleware/merchantWebhookSecret';
import { merchantRepository } from '../../src/repositories/merchant.repository';

jest.mock('../../src/repositories/merchant.repository', () => ({
  merchantRepository: {
    findByLocationId: jest.fn(),
    listActive: jest.fn(),
  },
}));

jest.mock('../../src/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

const mockFindByLocationId = merchantRepository.findByLocationId as jest.Mock;
const mockListActive = merchantRepository.listActive as jest.Mock;

function req(headers: Record<string, string> = {}, body: Record<string, unknown> = {}) {
  return {
    path: '/ghl/forms',
    body,
    header: (name: string) => headers[name.toLowerCase()],
  } as any;
}

function res() {
  const response: any = {
    status: jest.fn(() => response),
    json: jest.fn(() => response),
  };
  return response;
}

describe('requireMerchantWebhookSecret', () => {
  const originalRequireWebhookSecret = process.env.REQUIRE_WEBHOOK_SECRET;
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.REQUIRE_WEBHOOK_SECRET;
    process.env.NODE_ENV = 'test';
  });

  afterAll(() => {
    if (originalRequireWebhookSecret === undefined) {
      delete process.env.REQUIRE_WEBHOOK_SECRET;
    } else {
      process.env.REQUIRE_WEBHOOK_SECRET = originalRequireWebhookSecret;
    }
    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }
  });

  it('allows a valid secret and populates tenant context', async () => {
    mockFindByLocationId.mockResolvedValue({
      id: 'merchant_1',
      location_id: 'loc_1',
      webhook_secret: 'secret_1',
    });
    const request = req({ 'x-scalesafe-webhook-secret': 'secret_1' }, { locationId: 'loc_1' });
    const response = res();
    const next = jest.fn();

    await requireMerchantWebhookSecret(request, response, next);

    expect(next).toHaveBeenCalled();
    expect(response.status).not.toHaveBeenCalled();
    expect(request.tenantContext).toEqual({ locationId: 'loc_1', merchantId: 'merchant_1' });
  });

  it('observes missing secrets without blocking when enforcement is off', async () => {
    const response = res();
    const next = jest.fn();

    await requireMerchantWebhookSecret(req({}, { locationId: 'loc_1' }), response, next);

    expect(next).toHaveBeenCalled();
    expect(response.status).not.toHaveBeenCalled();
  });

  it('rejects missing secrets when enforcement is on', async () => {
    process.env.REQUIRE_WEBHOOK_SECRET = 'true';
    const response = res();
    const next = jest.fn();

    await requireMerchantWebhookSecret(req({}, { locationId: 'loc_1' }), response, next);

    expect(next).not.toHaveBeenCalled();
    expect(response.status).toHaveBeenCalledWith(401);
    expect(response.json).toHaveBeenCalledWith({ error: 'WEBHOOK_SECRET_REQUIRED' });
  });

  it('observes missing secrets in production when REQUIRE_WEBHOOK_SECRET is unset', async () => {
    process.env.NODE_ENV = 'production';
    const response = res();
    const next = jest.fn();

    await requireMerchantWebhookSecret(req({}, { locationId: 'loc_1' }), response, next);

    expect(next).toHaveBeenCalled();
    expect(response.status).not.toHaveBeenCalled();
  });

  it('rejects mismatched tenant secrets when enforcement is on', async () => {
    process.env.REQUIRE_WEBHOOK_SECRET = 'true';
    mockFindByLocationId.mockResolvedValue({
      id: 'merchant_1',
      location_id: 'loc_1',
      webhook_secret: 'secret_1',
    });
    const response = res();
    const next = jest.fn();

    await requireMerchantWebhookSecret(
      req({ authorization: 'Bearer secret_1' }, { locationId: 'loc_2' }),
      response,
      next,
    );

    expect(next).not.toHaveBeenCalled();
    expect(response.status).toHaveBeenCalledWith(403);
    expect(response.json).toHaveBeenCalledWith({ error: 'WEBHOOK_TENANT_MISMATCH' });
  });

  it('rejects invalid secrets when enforcement is on', async () => {
    process.env.REQUIRE_WEBHOOK_SECRET = 'true';
    mockListActive.mockResolvedValue([
      {
        id: 'merchant_1',
        location_id: 'loc_1',
        webhook_secret: 'secret_1',
      },
    ]);
    const response = res();
    const next = jest.fn();

    await requireMerchantWebhookSecret(req({ 'x-scalesafe-webhook-secret': 'wrong' }), response, next);

    expect(next).not.toHaveBeenCalled();
    expect(response.status).toHaveBeenCalledWith(401);
    expect(response.json).toHaveBeenCalledWith({ error: 'INVALID_WEBHOOK_SECRET' });
  });

  it('can validate a secret without using a database equality lookup', async () => {
    mockListActive.mockResolvedValue([
      {
        id: 'merchant_1',
        location_id: 'loc_1',
        webhook_secret: 'secret_1',
      },
      {
        id: 'merchant_2',
        location_id: 'loc_2',
        webhook_secret: 'secret_2',
      },
    ]);
    const response = res();
    const next = jest.fn();
    const request = req({ authorization: 'Bearer secret_2' });

    await requireMerchantWebhookSecret(request, response, next);

    expect(mockFindByLocationId).not.toHaveBeenCalled();
    expect(mockListActive).toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
    expect(request.tenantContext).toEqual({ locationId: 'loc_2', merchantId: 'merchant_2' });
  });
});
