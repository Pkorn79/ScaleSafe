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
    maybeSingle: () => ({
      data: filtered[0] || null,
      error: null,
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
        location_id: 'loc_1',
        merchant_id: 'merchant_1',
        consent_token: consentToken,
        ip_address: sharedIp,
        processor: 'stripe',
        processor_transaction_id: 'pi_test_1',
        amount: 50,
        ghl_order_id: 'ghl_order_1',
        created_at: '2026-04-01T00:00:00Z',
      },
    ];

    chainMockData['enrollments'] = [
      {
        id: 'packet_1',
        location_id: 'loc_1',
        consent_token: consentToken,
        consent_ip: sharedIp,
        consent_captured_at: '2026-04-01T00:00:00Z',
        created_at: '2026-04-01T00:00:00Z',
      },
    ];

    chainMockData['stripe_evidence_vault'] = [
      {
        id: 'vault_1',
        merchant_id: 'merchant_1',
        stripe_payment_intent_id: 'pi_test_1',
        evidence_score: 85,
        created_at: '2026-04-01T00:00:00Z',
      },
    ];

    const result = await evidenceChainService.verifyChain(paymentId, 'loc_1');

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
        location_id: 'loc_1',
        consent_token: consentToken,
        ip_address: '2.2.2.2',
        processor: 'nmi',
        processor_transaction_id: 'txn_nmi_1',
        amount: 100,
        created_at: '2026-04-01T00:00:00Z',
      },
    ];

    chainMockData['enrollments'] = [
      {
        id: 'packet_mismatch',
        location_id: 'loc_1',
        consent_token: consentToken,
        consent_ip: '1.1.1.1',
        consent_captured_at: '2026-04-01T00:00:00Z',
        created_at: '2026-04-01T00:00:00Z',
      },
    ];

    const result = await evidenceChainService.verifyChain(paymentId);

    expect(result.complete).toBe(false);
    expect(result.gaps.some(g => g.includes('IP mismatch'))).toBe(true);
    expect(result.chainStrength).toBeLessThan(100);
  });

  it('does not treat missing consent and payment IPs as a verified IP match', async () => {
    const paymentId = 'pay_null_ips';
    const consentToken = 'consent_null_ips';

    chainMockData['payment_events'] = [
      {
        id: paymentId,
        location_id: 'loc_1',
        consent_token: consentToken,
        ip_address: null,
        processor: 'nmi',
        processor_transaction_id: 'txn_nmi_null',
        amount: 100,
        created_at: '2026-04-01T00:00:00Z',
      },
    ];

    chainMockData['enrollments'] = [
      {
        id: 'enr_null_ips',
        location_id: 'loc_1',
        consent_token: consentToken,
        consent_ip: null,
        consent_captured_at: '2026-04-01T00:00:00Z',
        created_at: '2026-04-01T00:00:00Z',
      },
    ];

    const result = await evidenceChainService.verifyChain(paymentId, 'loc_1');

    expect(result.complete).toBe(false);
    expect(result.links.some(l => l.type === 'ip_match')).toBe(false);
    expect(result.gaps.some(g => g.includes('IP match unavailable'))).toBe(true);
  });

  it('links pay-first consent through the exact tenant-scoped enrollment ID', async () => {
    chainMockData['payment_events'] = [
      {
        id: 'pay_first_sale',
        location_id: 'loc_1',
        enrollment_id: 'enr_pay_first',
        consent_token: null,
        ip_address: null,
        processor: 'whop',
        processor_transaction_id: 'pay_whop_1',
        amount: 1.5,
        created_at: '2026-07-13T22:51:17Z',
      },
    ];
    chainMockData['enrollments'] = [
      {
        id: 'enr_pay_first',
        location_id: 'loc_1',
        consent_token: 'consent_after_payment',
        consent_ip: '1.2.3.4',
        consent_captured_at: '2026-07-13T22:56:43Z',
        created_at: '2026-07-13T22:49:07Z',
      },
      {
        id: 'enr_pay_first',
        location_id: 'loc_other',
        consent_token: 'wrong_tenant_consent',
        consent_ip: '9.9.9.9',
        consent_captured_at: '2026-07-13T22:56:43Z',
        created_at: '2026-07-13T22:49:07Z',
      },
    ];

    const result = await evidenceChainService.verifyChain('pay_first_sale', 'loc_1');

    expect(result.links).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'consent',
        id: 'enr_pay_first',
        detail: 'Consent matched through the payment event exact enrollment ID',
      }),
      expect.objectContaining({ type: 'payment', id: 'pay_first_sale' }),
    ]));
    expect(result.chainStrength).toBe(50);
    expect(result.gaps).toContain('IP match unavailable: consent=1.2.3.4, payment=missing');
  });

  it('should detect broken chain when no consent token linked', async () => {
    const paymentId = 'pay_no_consent';

    chainMockData['payment_events'] = [
      {
        id: paymentId,
        location_id: 'loc_1',
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
    expect(result.gaps).toContain('No consent token or enrollment linked to payment');
    expect(result.chainStrength).toBeLessThan(100);
  });

  it('should detect missing evidence vault for Stripe payments', async () => {
    const paymentId = 'pay_no_vault';

    chainMockData['payment_events'] = [
      {
        id: paymentId,
        location_id: 'loc_1',
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

  it('does not link a Stripe vault row owned by another merchant', async () => {
    chainMockData['payment_events'] = [{
      id: 'pay_cross_merchant',
      location_id: 'loc_1',
      merchant_id: 'merchant_1',
      consent_token: null,
      processor: 'stripe',
      processor_transaction_id: 'pi_shared',
      amount: 10,
      created_at: '2026-04-01T00:00:00Z',
    }];
    chainMockData['stripe_evidence_vault'] = [{
      id: 'vault_other',
      merchant_id: 'merchant_2',
      stripe_payment_intent_id: 'pi_shared',
      created_at: '2026-04-01T00:00:00Z',
    }];

    const result = await evidenceChainService.verifyChain('pay_cross_merchant', 'loc_1');

    expect(result.links.some(link => link.type === 'evidence_vault')).toBe(false);
    expect(result.gaps).toContain('Stripe evidence vault entry not found');
  });

  it('should return zero strength when payment event not found', async () => {
    chainMockData['payment_events'] = [];

    const result = await evidenceChainService.verifyChain('nonexistent');

    expect(result.complete).toBe(false);
    expect(result.chainStrength).toBe(0);
    expect(result.gaps).toContain('Payment event not found');
  });

  it('should not return a payment chain for another location', async () => {
    chainMockData['payment_events'] = [
      {
        id: 'pay_cross_tenant',
        location_id: 'loc_other',
        consent_token: null,
        ip_address: '5.5.5.5',
        processor: 'nmi',
        processor_transaction_id: 'txn_other',
        amount: 100,
        created_at: '2026-04-01T00:00:00Z',
      },
    ];

    const result = await evidenceChainService.verifyChain('pay_cross_tenant', 'loc_1');

    expect(result.complete).toBe(false);
    expect(result.links).toHaveLength(0);
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
