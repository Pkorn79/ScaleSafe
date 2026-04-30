import { requireMerchantWebhookSecret } from '../../src/middleware/merchantWebhookSecret';
import { merchantRepository } from '../../src/repositories/merchant.repository';

jest.mock('../../src/repositories/merchant.repository', () => ({
  merchantRepository: {
    findByWebhookSecret: jest.fn(),
  },
}));

jest.mock('../../src/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

const mockFindByWebhookSecret = merchantRepository.findByWebhookSecret as jest.Mock;

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

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.REQUIRE_WEBHOOK_SECRET;
  });

  afterAll(() => {
    if (originalRequireWebhookSecret === undefined) {
      delete process.env.REQUIRE_WEBHOOK_SECRET;
    } else {
      process.env.REQUIRE_WEBHOOK_SECRET = originalRequireWebhookSecret;
    }
  });

  it('allows a valid secret and populates tenant context', async () => {
    mockFindByWebhookSecret.mockResolvedValue({
      id: 'merchant_1',
      location_id: 'loc_1',
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

  it('rejects mismatched tenant secrets when enforcement is on', async () => {
    process.env.REQUIRE_WEBHOOK_SECRET = 'true';
    mockFindByWebhookSecret.mockResolvedValue({
      id: 'merchant_1',
      location_id: 'loc_1',
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
    mockFindByWebhookSecret.mockResolvedValue(null);
    const response = res();
    const next = jest.fn();

    await requireMerchantWebhookSecret(req({ 'x-scalesafe-webhook-secret': 'wrong' }), response, next);

    expect(next).not.toHaveBeenCalled();
    expect(response.status).toHaveBeenCalledWith(401);
    expect(response.json).toHaveBeenCalledWith({ error: 'INVALID_WEBHOOK_SECRET' });
  });
});
