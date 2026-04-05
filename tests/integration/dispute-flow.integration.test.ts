/**
 * Integration test: Dispute flow — triage, evidence assembly, EFW handling.
 * Mocks external APIs but tests internal service orchestration.
 */

const disputeMockData: Record<string, any[]> = {};
const disputeInsertedRows: Record<string, any[]> = {};

function resetDisputeStores() {
  Object.keys(disputeMockData).forEach(k => delete disputeMockData[k]);
  Object.keys(disputeInsertedRows).forEach(k => delete disputeInsertedRows[k]);
}

jest.mock('../../src/clients/supabase.client', () => ({
  getSupabase: () => ({
    from: (table: string) => createDisputeMockTable(table),
  }),
}));

function createDisputeMockTable(table: string) {
  const rows = disputeMockData[table] || [];
  if (!disputeInsertedRows[table]) disputeInsertedRows[table] = [];

  return {
    select: (_cols?: string) => createDisputeQuery(table, rows),
    insert: (data: any) => {
      const row = { id: `mock_${table}_${Date.now()}`, created_at: new Date().toISOString(), ...data };
      disputeInsertedRows[table].push(row);
      return {
        select: () => ({
          single: () => ({ data: row, error: null }),
        }),
      };
    },
    update: (data: any) => {
      // Apply update to matching rows
      return createDisputeQuery(table, rows, data);
    },
    upsert: (data: any, _opts?: any) => {
      const row = { id: `mock_${table}_${Date.now()}`, ...data };
      disputeInsertedRows[table].push(row);
      return {
        select: () => ({
          single: () => ({ data: row, error: null }),
        }),
      };
    },
  };
}

function createDisputeQuery(table: string, rows: any[], _updateData?: any) {
  let filtered = [...rows];
  const chain: any = {
    eq: (col: string, val: any) => {
      filtered = filtered.filter(r => r[col] === val);
      return chain;
    },
    or: (_expr: string) => chain,
    order: (_col: string, _opts?: any) => chain,
    limit: (_n: number) => chain,
    single: () => ({ data: filtered[0] || null, error: filtered.length === 0 ? null : null }),
  };
  return chain;
}

// Mock stripe
jest.mock('stripe', () => {
  return jest.fn(() => ({
    disputes: { update: jest.fn().mockResolvedValue({}) },
    refunds: { create: jest.fn().mockResolvedValue({}) },
    charges: { list: jest.fn().mockResolvedValue({ data: [] }) },
    disputes_list: jest.fn(),
  }));
});

jest.mock('../../src/config', () => ({
  config: {
    stripe: { secretKey: 'sk_test_fake', publishableKey: 'pk_test_fake', webhookSecret: 'whsec_fake', clientId: '' },
    appUrl: 'http://localhost:3000',
    logLevel: 'silent',
    isDev: true,
  },
}));

jest.mock('../../src/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import { stripeDisputeService } from '../../src/services/stripe-dispute.service';
import { stripeEfwService } from '../../src/services/stripe-efw.service';

describe('Dispute Flow Integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetDisputeStores();
  });

  describe('Dispute Triage', () => {
    it('should compute triage score and recommend fight when evidence is strong', () => {
      const vaultEntry = {
        contract_file_id: 'file_contract',
        communication_file_id: 'file_comm',
        session_file_ids: ['file_session_1'],
        ce30_eligible: true,
        customer_email: 'client@example.com',
        customer_billing_address: { line1: '123 Main St' },
        stripe_customer_id: 'cus_test',
      };

      const dispute = {
        id: 'dp_test_123',
        reason: 'fraudulent',
        amount: 50000,
      };

      const score = stripeDisputeService.computeTriageScore(dispute, vaultEntry);
      expect(score).toBeGreaterThanOrEqual(60);

      const recommendation = stripeDisputeService.getRecommendation(score, 50000);
      expect(recommendation.action).toBe('fight');
    });

    it('should recommend accept when evidence is weak', () => {
      const vaultEntry = null;
      const dispute = {
        id: 'dp_weak',
        reason: 'product_not_received',
        amount: 500000,
      };

      const score = stripeDisputeService.computeTriageScore(dispute, vaultEntry);
      expect(score).toBeLessThan(30);

      const recommendation = stripeDisputeService.getRecommendation(score, 500000);
      expect(recommendation.action).toBe('accept');
    });

    it('should recommend review for moderate evidence', () => {
      const vaultEntry = {
        contract_file_id: 'file_contract',
        communication_file_id: null,
        session_file_ids: [],
        ce30_eligible: false,
        customer_email: 'client@example.com',
        customer_billing_address: null,
        stripe_customer_id: 'cus_test',
      };

      const dispute = {
        id: 'dp_moderate',
        reason: 'fraudulent',
        amount: 100000,
      };

      const score = stripeDisputeService.computeTriageScore(dispute, vaultEntry);
      const recommendation = stripeDisputeService.getRecommendation(score, 100000);
      expect(['fight', 'review']).toContain(recommendation.action);
    });
  });

  describe('Deadline Tracking', () => {
    it('should calculate correct deadline alerts', () => {
      const futureTimestamp = Math.floor(Date.now() / 1000) + (14 * 24 * 60 * 60); // 14 days from now
      const alerts = stripeDisputeService.calculateDeadlineAlerts(futureTimestamp);

      expect(alerts.dueBy).toBeTruthy();
      expect(alerts.t7).toBeTruthy(); // 7 days before = 7 days from now
      expect(alerts.t3).toBeTruthy(); // 3 days before = 11 days from now
      expect(alerts.t1).toBeTruthy(); // 1 day before = 13 days from now
    });

    it('should return null for past alerts', () => {
      const nearFutureTimestamp = Math.floor(Date.now() / 1000) + (2 * 24 * 60 * 60); // 2 days from now
      const alerts = stripeDisputeService.calculateDeadlineAlerts(nearFutureTimestamp);

      expect(alerts.dueBy).toBeTruthy();
      expect(alerts.t7).toBeNull(); // T-7 is already past
      expect(alerts.t3).toBeNull(); // T-3 is already past
      expect(alerts.t1).toBeTruthy(); // T-1 is 1 day from now
    });
  });

  describe('Evidence Assembly — Reason Code Mapping', () => {
    it('should map fraudulent reason to correct evidence fields', () => {
      const vault = {
        customer_name: 'John Doe',
        customer_email: 'john@example.com',
        customer_ip: '1.2.3.4',
        customer_billing_address: { line1: '123 Main', city: 'NYC', state: 'NY', postal_code: '10001' },
        offer_description: 'Coaching Program',
        contract_file_id: 'file_contract_1',
        ce30_eligible: true,
      };

      const evidence = stripeDisputeService.mapReasonCodeToEvidence('fraudulent', vault, null);

      expect(evidence.customer_name).toBe('John Doe');
      expect(evidence.customer_email_address).toBe('john@example.com');
      expect(evidence.customer_purchase_ip).toBe('1.2.3.4');
      expect(evidence.billing_address).toContain('123 Main');
      expect(evidence.uncategorized_file).toBe('file_contract_1');
      expect(evidence.uncategorized_text).toContain('CE 3.0');
    });

    it('should map product_not_received to service delivery evidence', () => {
      const vault = {
        customer_name: 'Jane Smith',
        customer_email: 'jane@example.com',
        offer_description: 'Mentorship',
        service_start_date: '2026-01-15',
        communication_file_id: 'file_comm_1',
        session_file_ids: ['file_session_1', 'file_session_2'],
      };

      const evidence = stripeDisputeService.mapReasonCodeToEvidence('product_not_received', vault, null);

      expect(evidence.service_date).toBe('2026-01-15');
      expect(evidence.customer_communication).toBe('file_comm_1');
      expect(evidence.uncategorized_file).toBe('file_session_1');
      expect(evidence.uncategorized_text).toContain('2 session logs');
    });

    it('should map credit_not_processed to refund policy evidence', () => {
      const vault = {
        customer_name: 'Alice',
        customer_email: 'alice@example.com',
        offer_description: 'Course',
        refund_policy_text: 'No refunds after 14 days',
        contract_file_id: 'file_contract',
        terms_accepted: true,
        terms_accepted_at: '2026-01-01',
      };

      const evidence = stripeDisputeService.mapReasonCodeToEvidence('credit_not_processed', vault, null);

      expect(evidence.refund_policy).toBe('No refunds after 14 days');
      expect(evidence.uncategorized_text).toContain('accepted terms');
    });
  });

  describe('EFW Recommendation', () => {
    it('should recommend refund when dispute rate is high', () => {
      const rec = stripeEfwService.computeEfwRecommendation(50, 0.007, {});
      expect(rec.action).toBe('refund');
      expect(rec.reason).toContain('VAMP');
    });

    it('should recommend hold when evidence is strong and rate is low', () => {
      const rec = stripeEfwService.computeEfwRecommendation(80, 0.002, {});
      expect(rec.action).toBe('hold');
      expect(rec.reason).toContain('Strong documentation');
    });

    it('should recommend refund when evidence is weak and rate is moderate', () => {
      const rec = stripeEfwService.computeEfwRecommendation(30, 0.003, {});
      expect(rec.action).toBe('refund');
      expect(rec.reason).toContain('Consider refunding');
    });

    it('should recommend refund at dispute rate exactly at 0.006 threshold', () => {
      const rec = stripeEfwService.computeEfwRecommendation(90, 0.006, {});
      expect(rec.action).toBe('refund');
    });
  });
});
