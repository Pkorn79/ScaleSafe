import { whopApiBaseUrl } from '../../src/services/whop.service';

describe('whopApiBaseUrl', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.WHOP_API_BASE_URL;
    delete process.env.WHOP_SANDBOX_API_BASE_URL;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('uses Whop production API for production configs', () => {
    expect(whopApiBaseUrl('production')).toBe('https://api.whop.com/api/v5');
  });

  it('uses Whop sandbox API for sandbox configs', () => {
    expect(whopApiBaseUrl('sandbox')).toBe('https://sandbox-api.whop.com/api/v1');
  });

  it('allows sandbox-specific override without changing production', () => {
    process.env.WHOP_SANDBOX_API_BASE_URL = 'https://sandbox-api.whop.com/api/v5/';
    process.env.WHOP_API_BASE_URL = 'https://api.whop.com/api/v5/';

    expect(whopApiBaseUrl('sandbox')).toBe('https://sandbox-api.whop.com/api/v5');
    expect(whopApiBaseUrl('production')).toBe('https://api.whop.com/api/v5');
  });
});
