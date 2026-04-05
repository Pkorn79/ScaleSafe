jest.mock('../../src/clients/supabase.client', () => {
  const mockFrom = jest.fn();
  return { getSupabase: () => ({ from: mockFrom }), __mockFrom: mockFrom };
});

jest.mock('../../src/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import { evidenceChainService } from '../../src/services/evidence-chain.service';

const { __mockFrom: mockFrom } = require('../../src/clients/supabase.client');

describe('Evidence Chain Service', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('computeChainStrength', () => {
    it('returns 100 for complete chain', () => {
      const links = [
        { type: 'consent' as const, id: '1', timestamp: '', verified: true },
        { type: 'ip_match' as const, id: null, timestamp: '', verified: true },
        { type: 'payment' as const, id: '2', timestamp: '', verified: true },
        { type: 'evidence_vault' as const, id: '3', timestamp: '', verified: true },
        { type: 'ghl_order' as const, id: '4', timestamp: '', verified: true },
      ];
      expect(evidenceChainService.computeChainStrength(links)).toBe(100);
    });

    it('returns 20 for payment only', () => {
      const links = [
        { type: 'payment' as const, id: '1', timestamp: '', verified: true },
      ];
      expect(evidenceChainService.computeChainStrength(links)).toBe(20);
    });

    it('returns 50 for consent + payment', () => {
      const links = [
        { type: 'consent' as const, id: '1', timestamp: '', verified: true },
        { type: 'payment' as const, id: '2', timestamp: '', verified: true },
      ];
      expect(evidenceChainService.computeChainStrength(links)).toBe(50);
    });

    it('returns 70 for consent + ip_match + payment', () => {
      const links = [
        { type: 'consent' as const, id: '1', timestamp: '', verified: true },
        { type: 'ip_match' as const, id: null, timestamp: '', verified: true },
        { type: 'payment' as const, id: '2', timestamp: '', verified: true },
      ];
      expect(evidenceChainService.computeChainStrength(links)).toBe(70);
    });
  });

  describe('verifyChain', () => {
    it('returns not found for missing payment', async () => {
      mockFrom.mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({ data: null }),
          }),
        }),
      });

      const result = await evidenceChainService.verifyChain('missing-id');
      expect(result.complete).toBe(false);
      expect(result.gaps).toContain('Payment event not found');
      expect(result.chainStrength).toBe(0);
    });
  });
});
