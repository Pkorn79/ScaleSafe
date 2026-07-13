import {
  buildMerchantSettingsPayload,
  cloneViewState,
  getDefensePacketExhibitState,
  getDefensePacketExhibits,
  normalizeStripeHealthStatus,
} from '../../src/ui/src/utils/viewState';

describe('view state helpers', () => {
  test('reads frozen exhibits from a defense packet snapshot', () => {
    const exhibits = [{ id: 'exhibit-a' }];
    expect(getDefensePacketExhibits({ evidence_snapshot: { exhibits } })).toEqual(exhibits);
    expect(getDefensePacketExhibits({ evidence_snapshot: null })).toEqual([]);
  });

  test('reports a legacy packet exhibit count without presenting raw timeline rows as exhibits', () => {
    const state = getDefensePacketExhibitState({
      evidence_count: 8,
      evidence_snapshot: [{ type: 'communication' }, { type: 'payment' }],
    });

    expect(state).toEqual({ exhibits: [], reportedCount: 8, legacySnapshot: true });
  });

  test('prefers the frozen exhibit list while preserving a larger stored count defensively', () => {
    const exhibits = [{ letter: 'A' }, { letter: 'B' }];
    expect(getDefensePacketExhibitState({
      evidence_count: 2,
      evidence_snapshot: { exhibits },
    })).toEqual({ exhibits, reportedCount: 2, legacySnapshot: false });
  });

  test('does not present missing Stripe health classifications as safe', () => {
    expect(normalizeStripeHealthStatus(null, ['safe', 'high'])).toBe('unknown');
    expect(normalizeStripeHealthStatus('HIGH', ['safe', 'high'])).toBe('high');
    expect(normalizeStripeHealthStatus('unsupported', ['safe', 'high'])).toBe('unknown');
    expect(normalizeStripeHealthStatus('safe', ['safe', 'high'], false)).toBe('unknown');
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
