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
