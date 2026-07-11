import { INTEGRATION_PROVIDER_MAP, INTEGRATION_PROVIDERS } from '../../src/integrations/provider-catalog';

describe('integration provider catalog', () => {
  it('has stable unique provider keys across every rollout wave', () => {
    const keys = INTEGRATION_PROVIDERS.map((provider) => provider.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(INTEGRATION_PROVIDERS.length).toBeGreaterThan(50);
    expect(Math.max(...INTEGRATION_PROVIDERS.map((provider) => provider.wave))).toBe(7);
  });

  it('advertises access and purchase capabilities only for providers designed to support them', () => {
    expect(INTEGRATION_PROVIDER_MAP.get('teachable')?.capabilities).toEqual(expect.arrayContaining(['native_purchases', 'access_management']));
    expect(INTEGRATION_PROVIDER_MAP.get('zoom')?.capabilities).toContain('attendance');
    expect(INTEGRATION_PROVIDER_MAP.get('agencyanalytics')?.capabilities).toContain('reporting');
    expect(INTEGRATION_PROVIDER_MAP.get('calendly')?.capabilities).not.toContain('attendance');
    expect(INTEGRATION_PROVIDER_MAP.get('ghl_native')).toMatchObject({
      name: 'GHL Fulfillment',
      capabilities: expect.arrayContaining(['evidence', 'attendance', 'progress', 'communications']),
    });
  });
});
