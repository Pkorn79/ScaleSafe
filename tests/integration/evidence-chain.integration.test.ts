/**
 * Integration test: Evidence chain verification.
 * Mocks Supabase but tests full chain verification logic.
 */

const chainMockData: Record<string, any[]> = {};

function resetChainStores() {
  Object.keys(chainMockData).forEach(k => delete chainMockData[k]);
}

jest.mock('../../src/clients/supabase.client', () => ({
  getSupabase: () => ({
    from: (table: string) => createChainMockTable(table),
  }),
}));

function createChainMockTable(table: string) {
  const rows = chainMockData[table] || [];

  return {
    select: (_cols?: string) => createChainQuery(rows),
    insert: (data: any) => ({
      select: () => ({
        single: () => ({ data: { id: 'new', ...data }, error: null }),
      }),
    }),
    update: (_data: any) => createChainQuery(rows),
  };
}

function createChainQuery(rows: any[]) {
  let filtered = [...rows];
  const chain: any = {
    eq: (col: string, val: any) => {
      filtered = filtered.filter(r => r[col] === val);
      return chain;
    },
    order: (_col: string, _opts?: any) => chain,
    limit: (_n: number) => chain,
    single: () => ({
      data: filtered[0] || null,
      error: filtered.length === 0 ? { message: 'not found' } : null,
    }),
  };
  return chain;
}

jest.mock('../../src/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import { evidenceChainService } from '../../src/services/evidence-chain.service';

describe('Evidence Chain Integration', () => {
  beforeEach(() => {
    resetChainStores();
  });

  it('should verify complete chain: consent + IP match + payment + vault + GHL order', async () => {
    const paymentId = 'pay_123';
    const consentToken = 'consent_abc';
    const sharedIp = '1.2.3.4';

    chainMockData['payment_events'] = [
      {
        id: paymentId,
        consent_token: consentToken,
        ip_address: sharedIp,
        processor: 'stripe',
        processor_transaction_id: 'pi_test_1',
        amount: 50,
        ghl_order_id: 'ghl_order_1',
        created_at: '2026-04-01T00:00:00Z',
      },
    ];

    chainMockData['enrollment_packets'] = [
      {
        id: 'packet_1',
        consent_token: consentToken,
        consent_ip: sharedIp,
        consent_timestamp: '2026-04-01T00:00:00Z',
        created_at: '2026-04-01T00:00:00Z',
      },
    ];

    chainMockData['stripe_evidence_vault'] = [
      {
        id: 'vault_1',
        stripe_payment_intent_id: 'pi_test_1',
        evidence_score: 85,
        created_at: '2026-04-01T00:00:00Z',
      },
    ];

    const result = await evidenceChainService.verifyChain(paymentId);

    expect(result.complete).toBe(true);
    expect(result.gaps).toHaveLength(0);
    expect(result.chainStrength).toBe(100);

    // Verify all expected links are present
    const linkTypes = result.links.map(l => l.type);
    expect(linkTypes).toContain('consent');
    expect(linkTypes).toContain('ip_match');
    expect(linkTypes).toContain('payment');
    expect(linkTypes).toContain('evidence_vault');
    expect(linkTypes).toContain('ghl_order');
  });

  it('should detect IP mismatch between consent and payment', async () => {
    const paymentId = 'pay_mismatch';
    const consentToken = 'consent_mismatch';

    chainMockData['payment_events'] = [
      {
        id: paymentId,
        consent_token: consentToken,
        ip_address: '2.2.2.2',
        processor: 'nmi',
        processor_transaction_id: 'txn_nmi_1',
        amount: 100,
        created_at: '2026-04-01T00:00:00Z',
      },
    ];

    chainMockData['enrollment_packets'] = [
      {
        id: 'packet_mismatch',
        consent_token: consentToken,
        consent_ip: '1.1.1.1',
        consent_timestamp: '2026-04-01T00:00:00Z',
        created_at: '2026-04-01T00:00:00Z',
      },
    ];

    const result = await evidenceChainService.verifyChain(paymentId);

    expect(result.complete).toBe(false);
    expect(result.gaps.some(g => g.includes('IP mismatch'))).toBe(true);
    expect(result.chainStrength).toBeLessThan(100);
  });

  it('should detect broken chain when no consent token linked', async () => {
    const paymentId = 'pay_no_consent';

    chainMockData['payment_events'] = [
      {
        id: paymentId,
        consent_token: null,
        ip_address: '3.3.3.3',
        processor: 'nmi',
        processor_transaction_id: 'txn_nmi_2',
        amount: 200,
        created_at: '2026-04-01T00:00:00Z',
      },
    ];

    const result = await evidenceChainService.verifyChain(paymentId);

    expect(result.complete).toBe(false);
    expect(result.gaps).toContain('No consent token linked to payment');
    expect(result.chainStrength).toBeLessThan(100);
  });

  it('should detect missing evidence vault for Stripe payments', async () => {
    const paymentId = 'pay_no_vault';

    chainMockData['payment_events'] = [
      {
        id: paymentId,
        consent_token: null,
        ip_address: '4.4.4.4',
        processor: 'stripe',
        processor_transaction_id: 'pi_no_vault',
        amount: 300,
        created_at: '2026-04-01T00:00:00Z',
      },
    ];

    chainMockData['stripe_evidence_vault'] = [];

    const result = await evidenceChainService.verifyChain(paymentId);

    expect(result.complete).toBe(false);
    expect(result.gaps.some(g => g.includes('vault'))).toBe(true);
  });

  it('should return zero strength when payment event not found', async () => {
    chainMockData['payment_events'] = [];

    const result = await evidenceChainService.verifyChain('nonexistent');

    expect(result.complete).toBe(false);
    expect(result.chainStrength).toBe(0);
    expect(result.gaps).toContain('Payment event not found');
  });

  describe('Chain Strength Computation', () => {
    it('should score 0 for empty links', () => {
      expect(evidenceChainService.computeChainStrength([])).toBe(0);
    });

    it('should score 50 for consent + payment only', () => {
      const links = [
        { type: 'consent' as const, id: '1', timestamp: '', verified: true },
        { type: 'payment' as const, id: '2', timestamp: '', verified: true },
      ];
      expect(evidenceChainService.computeChainStrength(links)).toBe(50);
    });

    it('should cap at 100', () => {
      const links = [
        { type: 'consent' as const, id: '1', timestamp: '', verified: true },
        { type: 'ip_match' as const, id: null, timestamp: '', verified: true },
        { type: 'payment' as const, id: '2', timestamp: '', verified: true },
        { type: 'evidence_vault' as const, id: '3', timestamp: '', verified: true },
        { type: 'ghl_order' as const, id: '4', timestamp: '', verified: true },
      ];
      expect(evidenceChainService.computeChainStrength(links)).toBe(100);
    });
  });
});
