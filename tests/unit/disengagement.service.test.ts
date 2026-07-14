/**
 * Disengagement service tests.
 * Tests risk scoring signals and threshold behavior.
 */

const mockQuery = jest.fn();
const mockFrom = jest.fn().mockReturnValue({
  select: jest.fn().mockReturnValue({
    eq: jest.fn().mockReturnValue({
      order: jest.fn().mockReturnValue({
        limit: jest.fn().mockReturnValue({
          single: jest.fn().mockResolvedValue({ data: null, error: null }),
        }),
      }),
      eq: jest.fn().mockReturnValue({
        order: jest.fn().mockReturnValue({
          limit: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({ data: null, error: null }),
          }),
        }),
      }),
    }),
  }),
});

jest.mock('../../src/clients/supabase.client', () => ({
  getSupabase: () => ({ from: mockFrom }),
}));

jest.mock('../../src/repositories/merchant.repository', () => ({
  merchantRepository: {
    getByLocationId: jest.fn().mockResolvedValue({
      location_id: 'loc_1',
      config: {},
    }),
  },
}));

jest.mock('../../src/repositories/evidence.repository', () => ({
  evidenceRepository: {
    getLastEvidenceDate: jest.fn().mockResolvedValue(new Date().toISOString()),
  },
}));

import { disengagementService } from '../../src/services/disengagement.service';

beforeEach(() => {
  jest.clearAllMocks();
  disengagementService.invalidateAtRiskCache('loc_cache');
});

describe('Disengagement Service - Scoring', () => {
  test('client with no signals gets low risk score', async () => {
    const result = await disengagementService.scoreClient('loc_1', 'contact_1');
    expect(result.riskScore).toBeLessThan(40);
    expect(result.flagged).toBe(false);
    expect(result.riskFactors).toHaveLength(0);
  });

  test('result includes all required fields', async () => {
    const result = await disengagementService.scoreClient('loc_1', 'contact_1');
    expect(result).toHaveProperty('contactId', 'contact_1');
    expect(result).toHaveProperty('locationId', 'loc_1');
    expect(result).toHaveProperty('riskScore');
    expect(result).toHaveProperty('riskFactors');
    expect(result).toHaveProperty('daysInactive');
    expect(result).toHaveProperty('flagged');
  });

  test('risk score is between 0 and 100', async () => {
    const result = await disengagementService.scoreClient('loc_1', 'contact_1');
    expect(result.riskScore).toBeGreaterThanOrEqual(0);
    expect(result.riskScore).toBeLessThanOrEqual(100);
  });

  test('flagged threshold is 40', async () => {
    const result = await disengagementService.scoreClient('loc_1', 'contact_1');
    if (result.riskScore >= 40) {
      expect(result.flagged).toBe(true);
    } else {
      expect(result.flagged).toBe(false);
    }
  });
});

describe('Disengagement Service - dashboard scan control', () => {
  test('scores a location with bounded bulk reads instead of per-contact queries', async () => {
    const now = new Date().toISOString();
    const dataByTable: Record<string, any[]> = {
      client_list_view: [{ contact_id: 'contact_bulk', status: 'active' }],
      evidence_timeline: [
        { contact_id: 'contact_bulk', type: 'attendance', created_at: now, data: { status: 'no_show' } },
        { contact_id: 'contact_bulk', type: 'attendance', created_at: now, data: { status: 'no_show' } },
        { contact_id: 'contact_bulk', type: 'pulse_checkin', created_at: now, data: { satisfaction_score: 2 } },
      ],
      evidence: [],
      evidence_appointments: [],
      evidence_invoices: [],
    };
    const query = (data: any[]) => {
      const result = Promise.resolve({ data, error: null });
      const chain: any = {
        select: () => chain,
        eq: () => chain,
        in: () => chain,
        gte: () => chain,
        order: () => chain,
        limit: () => chain,
        then: result.then.bind(result),
      };
      return chain;
    };
    mockFrom.mockImplementation((table: string) => query(dataByTable[table] || []));

    const result = await disengagementService.scoreAllClients('loc_bulk');

    expect(mockFrom).toHaveBeenCalledTimes(5);
    expect(result).toEqual([expect.objectContaining({
      contactId: 'contact_bulk',
      riskScore: 40,
      flagged: true,
    })]);
  });

  test('deduplicates concurrent scans and serves the cached result', async () => {
    let releaseScan!: (value: any[]) => void;
    const scanResult = new Promise<any[]>((resolve) => { releaseScan = resolve; });
    const scoreSpy = jest.spyOn(disengagementService, 'scoreAllClients')
      .mockImplementation(async () => scanResult);

    const first = disengagementService.getAtRiskClients('loc_cache');
    const second = disengagementService.getAtRiskClients('loc_cache');
    releaseScan([
      { contactId: 'safe', locationId: 'loc_cache', riskScore: 10, riskFactors: [], daysInactive: 1, flagged: false },
      { contactId: 'risk', locationId: 'loc_cache', riskScore: 55, riskFactors: ['No response'], daysInactive: 30, flagged: true },
    ]);

    await expect(first).resolves.toEqual([expect.objectContaining({ contactId: 'risk' })]);
    await expect(second).resolves.toEqual([expect.objectContaining({ contactId: 'risk' })]);
    await expect(disengagementService.getAtRiskClients('loc_cache'))
      .resolves.toEqual([expect.objectContaining({ contactId: 'risk' })]);
    expect(scoreSpy).toHaveBeenCalledTimes(1);

    scoreSpy.mockRestore();
  });
});
