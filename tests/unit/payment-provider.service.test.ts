const mockPost = jest.fn();
const mockFrom = jest.fn();

jest.mock('../../src/clients/ghl.client', () => ({
  ghlApi: jest.fn(async () => ({ post: mockPost })),
}));

jest.mock('../../src/clients/supabase.client', () => ({
  getSupabase: () => ({ from: mockFrom }),
}));

jest.mock('../../src/config', () => ({
  config: {
    appUrl: 'https://dashboard.scalesafe.app',
    logLevel: 'silent',
  },
}));

import { paymentProviderService } from '../../src/services/payment-provider.service';

function merchantQuery(data: any) {
  const query: any = {
    select: jest.fn(() => query),
    update: jest.fn(() => query),
    eq: jest.fn(() => query),
    single: jest.fn(async () => ({ data, error: null })),
  };
  return query;
}

describe('paymentProviderService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPost.mockResolvedValue({ data: {} });
    mockFrom.mockReturnValue(merchantQuery({
      provider_api_key: 'ss_live_test',
      provider_publishable_key: 'ss_pub_test',
    }));
  });

  it('sends locationId in both body and query params for GHL custom provider registration', async () => {
    await paymentProviderService.registerProvider('loc_1');

    expect(mockPost).toHaveBeenCalledWith(
      '/payments/custom-provider/provider',
      expect.objectContaining({ locationId: 'loc_1' }),
      { params: { locationId: 'loc_1' } },
    );
  });

  it('sends locationId in both body and query params when connecting provider config', async () => {
    await paymentProviderService.connectConfig('loc_1');

    expect(mockPost).toHaveBeenCalledWith(
      '/payments/custom-provider/connect',
      expect.objectContaining({
        locationId: 'loc_1',
        live: expect.objectContaining({ apiKey: 'ss_live_test' }),
      }),
      { params: { locationId: 'loc_1' } },
    );
  });
});
