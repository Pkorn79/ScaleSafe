import {
  buildMerchantSettingsPayload,
  cloneViewState,
  getDefensePacketExhibits,
  normalizeStripeHealthStatus,
} from '../../src/ui/src/utils/viewState';

describe('view state helpers', () => {
  test('reads frozen exhibits from a defense packet snapshot', () => {
    const exhibits = [{ id: 'exhibit-a' }];
    expect(getDefensePacketExhibits({ evidence_snapshot: { exhibits } })).toEqual(exhibits);
    expect(getDefensePacketExhibits({ evidence_snapshot: null })).toEqual([]);
  });

  test('does not present missing Stripe health classifications as safe', () => {
    expect(normalizeStripeHealthStatus(null, ['safe', 'high'])).toBe('unknown');
    expect(normalizeStripeHealthStatus('HIGH', ['safe', 'high'])).toBe('high');
    expect(normalizeStripeHealthStatus('unsupported', ['safe', 'high'])).toBe('unknown');
  });

  test('settings payload changes only when a saved setting changes', () => {
    const config = {
      businessName: 'WholePay',
      supportEmail: 'support@example.com',
      modules: { pulse: true },
      snapshotStatus: 'installed',
    };
    const thresholds = { pulseScoreThreshold: 2 };
    const baseline = cloneViewState(buildMerchantSettingsPayload(config, thresholds));

    config.snapshotStatus = 'partial';
    expect(buildMerchantSettingsPayload(config, thresholds)).toEqual(baseline);

    config.businessName = 'ScaleSafe';
    expect(buildMerchantSettingsPayload(config, thresholds)).not.toEqual(baseline);
  });
});
