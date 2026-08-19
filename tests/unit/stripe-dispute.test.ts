// ─── Mocks (must be before imports) ────────────────────────────────

const mockFrom = jest.fn();
const mockSupabase = {
  from: mockFrom,
};

jest.mock('../../src/clients/supabase.client', () => ({
  getSupabase: () => mockSupabase,
}));

const mockDisputesUpdate = jest.fn().mockResolvedValue({});
const mockDisputesClose = jest.fn().mockResolvedValue({});
const mockDisputesList = jest.fn().mockResolvedValue({ data: [], has_more: false });
const mockChargesList = jest.fn().mockResolvedValue({ data: [], has_more: false });
const mockRefundsCreate = jest.fn().mockResolvedValue({ id: 're_test' });

jest.mock('stripe', () => jest.fn(() => ({
  disputes: {
    update: mockDisputesUpdate,
    close: mockDisputesClose,
    list: mockDisputesList,
  },
  charges: { list: mockChargesList },
  refunds: { create: mockRefundsCreate },
})));

jest.mock('../../src/config', () => ({
  config: {
    stripe: { secretKey: 'sk_test', publishableKey: 'pk_test', clientId: '', webhookSecret: 'whsec_test', liveMode: false },
    appUrl: 'https://app.scalesafe.com',
    logLevel: 'silent', isDev: true, nodeEnv: 'test',
  },
}));

jest.mock('../../src/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const mockRequireActiveStripeConnection = jest.fn();
jest.mock('../../src/services/stripe-connection-mode.service', () => ({
  requireActiveStripeConnection: (...args: any[]) => mockRequireActiveStripeConnection(...args),
}));

// ─── Imports ────────────────────────────────────────────────────────

import { stripeDisputeService } from '../../src/services/stripe-dispute.service';
import { stripeEfwService } from '../../src/services/stripe-efw.service';

// ─── Helpers ────────────────────────────────────────────────────────

function makeVaultEntry(overrides: Record<string, any> = {}): any {
  return {
    id: 'vault-1',
    merchant_id: 'merchant-1',
    stripe_charge_id: 'ch_test',
    stripe_customer_id: 'cus_test',
    customer_name: 'John Doe',
    customer_email: 'john@example.com',
    customer_ip: '192.168.1.1',
    customer_billing_address: { line1: '123 Main St', city: 'Austin', state: 'TX', postal_code: '78701' },
    offer_title: 'Coaching Program',
    offer_description: '12-week coaching engagement',
    contract_file_id: 'file_contract_1',
    terms_file_id: 'file_terms_1',
    communication_file_id: 'file_comm_1',
    session_file_ids: ['file_session_1', 'file_session_2'],
    ce30_eligible: false,
    ce30_fields_complete: true,
    refund_policy_text: 'No refunds after program commencement.',
    terms_accepted: true,
    terms_accepted_at: '2026-01-15T00:00:00Z',
    service_start_date: '2026-01-20',
    evidence_score: 85,
    ...overrides,
  };
}

function makeDispute(overrides: Record<string, any> = {}): any {
  return {
    id: 'dp_test123',
    charge: 'ch_test',
    amount: 150000, // $1500
    currency: 'usd',
    reason: 'fraudulent',
    status: 'needs_response',
    created: Math.floor(Date.now() / 1000),
    evidence_details: {
      due_by: Math.floor(Date.now() / 1000) + (21 * 24 * 60 * 60), // 21 days from now
    },
    ...overrides,
  };
}

// ─── Reset mocks ────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  mockRequireActiveStripeConnection.mockResolvedValue({
    stripe_user_id: 'acct_test123',
    stripe_livemode: false,
  });
  // Default mock: from() returns chainable update
  mockFrom.mockReturnValue({
    update: jest.fn().mockReturnValue({
      eq: jest.fn().mockReturnValue({
        eq: jest.fn().mockResolvedValue({ error: null }),
      }),
    }),
    select: jest.fn().mockReturnValue({
      eq: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          single: jest.fn().mockResolvedValue({ data: null }),
        }),
        single: jest.fn().mockResolvedValue({ data: null }),
      }),
    }),
    upsert: jest.fn().mockResolvedValue({ error: null }),
    insert: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({
        single: jest.fn().mockResolvedValue({ data: { id: 'test' }, error: null }),
      }),
    }),
  });
});

// ═════════════════════════════════════════════════════════════════════
// DISPUTE TRIAGE SCORING
// ═════════════════════════════════════════════════════════════════════

describe('Dispute Triage Service', () => {
  describe('computeTriageScore', () => {
    it('returns high score (>= 60) with full evidence vault', () => {
      const vault = makeVaultEntry();
      const dispute = makeDispute();
      const score = stripeDisputeService.computeTriageScore(dispute, vault);
      expect(score).toBeGreaterThanOrEqual(60);
    });

    it('returns low score (< 30) with no evidence', () => {
      const dispute = makeDispute({ reason: 'product_not_received' });
      const score = stripeDisputeService.computeTriageScore(dispute, null);
      expect(score).toBeLessThan(30);
    });

    it('returns mid-range score (30-59) with partial evidence', () => {
      const vault = makeVaultEntry({
        contract_file_id: 'file_1',
        terms_file_id: null,
        communication_file_id: null,
        session_file_ids: [],
        ce30_eligible: false,
        customer_billing_address: null,
      });
      const dispute = makeDispute({ reason: 'fraudulent' });
      const score = stripeDisputeService.computeTriageScore(dispute, vault);
      expect(score).toBeGreaterThanOrEqual(30);
      expect(score).toBeLessThan(60);
    });

    it('applies large amount penalty for amounts > $3000', () => {
      const vault = makeVaultEntry();
      const normalDispute = makeDispute({ amount: 100000 }); // $1000
      const largeDispute = makeDispute({ amount: 500000 }); // $5000

      const normalScore = stripeDisputeService.computeTriageScore(normalDispute, vault);
      const largeScore = stripeDisputeService.computeTriageScore(largeDispute, vault);

      expect(largeScore).toBeLessThan(normalScore);
    });

    it('applies negative reason code penalty', () => {
      const vault = makeVaultEntry();
      const fraudDispute = makeDispute({ reason: 'fraudulent' });
      const pnrDispute = makeDispute({ reason: 'product_not_received' });

      const fraudScore = stripeDisputeService.computeTriageScore(fraudDispute, vault);
      const pnrScore = stripeDisputeService.computeTriageScore(pnrDispute, vault);

      expect(pnrScore).toBeLessThan(fraudScore);
    });

    it('clamps score to 0 minimum', () => {
      // No vault, bad reason, large amount — should trigger all negatives
      const dispute = makeDispute({
        reason: 'product_not_received',
        amount: 500000,
      });
      const score = stripeDisputeService.computeTriageScore(dispute, null);
      expect(score).toBe(0);
    });

    it('clamps score to 100 maximum', () => {
      // Full vault, good reason — should not exceed 100
      const vault = makeVaultEntry();
      const dispute = makeDispute({ reason: 'credit_not_processed' });
      const score = stripeDisputeService.computeTriageScore(dispute, vault);
      expect(score).toBeLessThanOrEqual(100);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // RECOMMENDATION LOGIC
  // ═══════════════════════════════════════════════════════════════════

  describe('getRecommendation', () => {
    it('recommends fight for score >= 60', () => {
      const rec = stripeDisputeService.getRecommendation(75, 150000);
      expect(rec.action).toBe('fight');
    });

    it('recommends review for score 30-59', () => {
      const rec = stripeDisputeService.getRecommendation(45, 150000);
      expect(rec.action).toBe('review');
    });

    it('recommends accept for score < 30', () => {
      const rec = stripeDisputeService.getRecommendation(15, 150000);
      expect(rec.action).toBe('accept');
    });

    it('includes estimated cost in recommendation', () => {
      const rec = stripeDisputeService.getRecommendation(75, 150000);
      expect(rec.estimatedCost).toContain('$1500.00');
    });

    it('returns boundary case: score exactly 60 = fight', () => {
      const rec = stripeDisputeService.getRecommendation(60, 100000);
      expect(rec.action).toBe('fight');
    });

    it('returns boundary case: score exactly 30 = review', () => {
      const rec = stripeDisputeService.getRecommendation(30, 100000);
      expect(rec.action).toBe('review');
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // DEADLINE TRACKING
  // ═══════════════════════════════════════════════════════════════════

  describe('calculateDeadlineAlerts', () => {
    it('calculates T-7, T-3, T-1 correctly for future deadline', () => {
      const futureTimestamp = Math.floor(Date.now() / 1000) + (21 * 24 * 60 * 60); // 21 days from now
      const alerts = stripeDisputeService.calculateDeadlineAlerts(futureTimestamp);

      expect(alerts.dueBy).toBeDefined();
      expect(alerts.t7).not.toBeNull();
      expect(alerts.t3).not.toBeNull();
      expect(alerts.t1).not.toBeNull();
    });

    it('returns null for past T-7/T-3/T-1 dates', () => {
      // Deadline is 2 days from now — T-7 and T-3 are already past
      const nearTimestamp = Math.floor(Date.now() / 1000) + (2 * 24 * 60 * 60);
      const alerts = stripeDisputeService.calculateDeadlineAlerts(nearTimestamp);

      expect(alerts.t7).toBeNull();
      expect(alerts.t3).toBeNull();
      expect(alerts.t1).not.toBeNull();
    });

    it('returns all null for deadline in the past', () => {
      const pastTimestamp = Math.floor(Date.now() / 1000) - (24 * 60 * 60); // 1 day ago
      const alerts = stripeDisputeService.calculateDeadlineAlerts(pastTimestamp);

      expect(alerts.t7).toBeNull();
      expect(alerts.t3).toBeNull();
      expect(alerts.t1).toBeNull();
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // EVIDENCE ASSEMBLY — REASON CODE MAPPING
  // ═══════════════════════════════════════════════════════════════════

  describe('mapReasonCodeToEvidence', () => {
    it('returns empty evidence for null vault', () => {
      const evidence = stripeDisputeService.mapReasonCodeToEvidence('fraudulent', null, null);
      expect(Object.keys(evidence)).toHaveLength(0);
    });

    it('includes common fields for all reason codes', () => {
      const vault = makeVaultEntry();
      const evidence = stripeDisputeService.mapReasonCodeToEvidence('fraudulent', vault, null);
      expect(evidence['customer_name']).toBe('John Doe');
      expect(evidence['customer_email_address']).toBe('john@example.com');
      expect(evidence['product_description']).toBe('12-week coaching engagement');
    });

    it('maps fraudulent reason with IP, billing address, and factual identity text', () => {
      const vault = makeVaultEntry();
      const evidence = stripeDisputeService.mapReasonCodeToEvidence('fraudulent', vault, null);
      expect(evidence['customer_purchase_ip']).toBe('192.168.1.1');
      expect(evidence['billing_address']).toContain('123 Main St');
      // Must state only captured facts — never an unverified CE 3.0 eligibility claim.
      expect(evidence['uncategorized_text']).toContain('identity data captured at the time of purchase');
      expect(evidence['uncategorized_text']).toContain('192.168.1.1');
      expect(evidence['uncategorized_text']).not.toContain('CE 3.0');
      expect(evidence['uncategorized_text']).not.toContain('prior non-disputed transactions');
      expect(evidence['uncategorized_file']).toBe('file_contract_1');
    });

    it('maps product_not_received with session logs and communication', () => {
      const vault = makeVaultEntry();
      const evidence = stripeDisputeService.mapReasonCodeToEvidence('product_not_received', vault, null);
      expect(evidence['service_date']).toBe('2026-01-20');
      expect(evidence['customer_communication']).toBe('file_comm_1');
      expect(evidence['uncategorized_file']).toBe('file_session_1');
      expect(evidence['uncategorized_text']).toContain('2 session logs');
    });

    it('appends app service evidence for product_not_received disputes', () => {
      const vault = makeVaultEntry();
      const evidence = stripeDisputeService.mapReasonCodeToEvidence('product_not_received', vault, null, {
        serviceText: 'Exhibit C: Session Completion - Client attended the kickoff session and received the onboarding deliverables.',
      });

      expect(evidence['customer_communication']).toBe('file_comm_1');
      expect(evidence['uncategorized_text']).toContain('2 session logs');
      expect(evidence['uncategorized_text']).toContain('Client attended the kickoff session');
    });

    it('routes app communication TEXT to uncategorized_text — customer_communication is a FILE-only field', () => {
      const vault = makeVaultEntry({ communication_file_id: null });
      const evidence = stripeDisputeService.mapReasonCodeToEvidence('product_not_received', vault, null, {
        communicationText: 'Exhibit D: Client Communication - Enrollment link sent and subsequent check-in message delivered.',
      });

      expect(evidence['customer_communication']).toBeUndefined();
      expect(evidence['uncategorized_text']).toContain('Enrollment link sent');
    });

    it('maps general reason with contract, communication, refund policy (text goes to *_disclosure fields)', () => {
      const vault = makeVaultEntry();
      const evidence = stripeDisputeService.mapReasonCodeToEvidence('general', vault, null);
      expect(evidence['uncategorized_file']).toBe('file_contract_1');
      expect(evidence['customer_communication']).toBe('file_comm_1');
      // refund_policy / cancellation_policy only accept Stripe file ids — the
      // text versions must land in the *_disclosure fields or Stripe 400s.
      expect(evidence['refund_policy']).toBeUndefined();
      expect(evidence['cancellation_policy']).toBeUndefined();
      expect(evidence['refund_policy_disclosure']).toContain('No refunds');
      expect(evidence['cancellation_policy_disclosure']).toContain('No refunds');
    });

    it('maps general reason: falls back to offer terms file when no contract', () => {
      const vault = makeVaultEntry({ contract_file_id: null });
      const evidence = stripeDisputeService.mapReasonCodeToEvidence('general', vault, 'file_terms_offer');
      expect(evidence['uncategorized_file']).toBe('file_terms_offer');
    });

    it('maps credit_not_processed with refund policy and contract', () => {
      const vault = makeVaultEntry();
      const evidence = stripeDisputeService.mapReasonCodeToEvidence('credit_not_processed', vault, null);
      expect(evidence['refund_policy_disclosure']).toContain('No refunds');
      expect(evidence['refund_policy']).toBeUndefined();
      expect(evidence['uncategorized_file']).toBe('file_contract_1');
      expect(evidence['uncategorized_text']).toContain('no-refund policy');
    });

    it('appends termination timeline for credit_not_processed disputes', () => {
      const vault = makeVaultEntry();
      const evidence = stripeDisputeService.mapReasonCodeToEvidence('credit_not_processed', vault, null, {
        terminationText: 'Exhibit G: Refund Review - Merchant reviewed the refund request and recorded the policy basis for denial.',
      });

      expect(evidence['refund_policy_disclosure']).toContain('No refunds');
      expect(evidence['uncategorized_text']).toContain('no-refund policy');
      expect(evidence['uncategorized_text']).toContain('policy basis for denial');
    });

    it('maps unrecognized with IP, email, descriptor explanation', () => {
      const vault = makeVaultEntry();
      const evidence = stripeDisputeService.mapReasonCodeToEvidence('unrecognized', vault, null);
      expect(evidence['customer_purchase_ip']).toBe('192.168.1.1');
      expect(evidence['uncategorized_text']).toContain('Coaching Program');
    });

    it('maps unknown reason with available evidence', () => {
      const vault = makeVaultEntry();
      const evidence = stripeDisputeService.mapReasonCodeToEvidence('some_other_reason', vault, null);
      expect(evidence['uncategorized_file']).toBe('file_contract_1');
      expect(evidence['customer_communication']).toBe('file_comm_1');
      expect(evidence['refund_policy_disclosure']).toContain('No refunds');
    });

    it('can build text-only evidence when the Stripe vault is missing but app evidence exists', () => {
      const evidence = stripeDisputeService.mapReasonCodeToEvidence('general', null, null, {
        summaryText: 'ScaleSafe app evidence summary: Exhibit A signed packet, Exhibit B payment confirmation, Exhibit C service access.',
      });

      expect(evidence['uncategorized_text']).toContain('signed packet');
      expect(evidence['cancellation_policy_disclosure']).toContain('No cancellations');
    });

    it('never puts non-Stripe ids into file-only fields', () => {
      const vault = makeVaultEntry({
        contract_file_id: 'supabase/path/contract.pdf',
        communication_file_id: 'not-a-stripe-id',
      });
      const evidence = stripeDisputeService.mapReasonCodeToEvidence('general', vault, null);
      expect(evidence['uncategorized_file']).toBeUndefined();
      expect(evidence['customer_communication']).toBeUndefined();
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // PACKET PDF UPLOAD (direct fetch — bypasses the SDK's multipart path)
  // ═══════════════════════════════════════════════════════════════════

  describe('uploadDefensePacketFile', () => {
    const realFetch = (global as any).fetch;
    afterEach(() => { (global as any).fetch = realFetch; });

    it('POSTs a multipart form to files.stripe.com on the connected account', async () => {
      const fetchMock = jest.fn().mockResolvedValue({
        ok: true, status: 200, json: async () => ({ id: 'file_up_1' }),
      });
      (global as any).fetch = fetchMock;

      const id = await stripeDisputeService.uploadDefensePacketFile({
        merchantStripeAccountId: 'acct_1',
        buffer: Buffer.from('%PDF-1.4 test'),
        filename: 'packet.pdf',
      });

      expect(id).toBe('file_up_1');
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('https://files.stripe.com/v1/files');
      expect(init.method).toBe('POST');
      expect(init.headers['Stripe-Account']).toBe('acct_1');
      expect(init.headers.Authorization).toMatch(/^Bearer sk_test/);
      expect(init.body).toBeInstanceOf(FormData);
      expect(init.body.get('purpose')).toBe('dispute_evidence');
      const filePart = init.body.get('file');
      expect(filePart).toBeTruthy();
      expect(filePart.type).toBe('application/pdf');
    });

    it('throws with Stripe error detail (message + param) on failure', async () => {
      (global as any).fetch = jest.fn().mockResolvedValue({
        ok: false, status: 400,
        json: async () => ({ error: { message: 'Invalid purpose', param: 'purpose' } }),
      });

      await expect(stripeDisputeService.uploadDefensePacketFile({
        merchantStripeAccountId: 'acct_1',
        buffer: Buffer.from('x'),
        filename: 'p.pdf',
      })).rejects.toThrow('Invalid purpose (param: purpose)');
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // EVIDENCE SUBMISSION
  // ═══════════════════════════════════════════════════════════════════

  describe('submitEvidence', () => {
    beforeEach(() => {
      // Mock merchant lookup
      mockFrom.mockImplementation((table: string) => {
        if (table === 'merchants') {
          return {
            select: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                single: jest.fn().mockResolvedValue({
                  data: { stripe_user_id: 'acct_test123' },
                }),
              }),
            }),
          };
        }
        return {
          update: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              eq: jest.fn().mockResolvedValue({ error: null }),
            }),
          }),
        };
      });
    });

    it('calls stripe.disputes.update with correct params for auto-submit', async () => {
      const evidence = { customer_name: 'John', refund_policy: 'No refunds' };
      await stripeDisputeService.submitEvidence({
        stripeDisputeId: 'dp_test',
        merchantId: 'merchant-1',
        evidence,
        autoSubmit: true,
      });

      expect(mockDisputesUpdate).toHaveBeenCalledWith(
        'dp_test',
        { evidence, submit: true },
        { stripeAccount: 'acct_test123' },
      );
    });

    it('calls stripe.disputes.update with submit: false for staged submission', async () => {
      const evidence = { customer_name: 'Jane' };
      await stripeDisputeService.submitEvidence({
        stripeDisputeId: 'dp_test',
        merchantId: 'merchant-1',
        evidence,
        autoSubmit: false,
      });

      expect(mockDisputesUpdate).toHaveBeenCalledWith(
        'dp_test',
        { evidence, submit: false },
        { stripeAccount: 'acct_test123' },
      );
    });

    it('returns staged: true when autoSubmit is false', async () => {
      const result = await stripeDisputeService.submitEvidence({
        stripeDisputeId: 'dp_test',
        merchantId: 'merchant-1',
        evidence: {},
        autoSubmit: false,
      });
      expect(result.staged).toBe(true);
      expect(result.success).toBe(true);
    });

    it('returns staged: false when autoSubmit is true', async () => {
      const result = await stripeDisputeService.submitEvidence({
        stripeDisputeId: 'dp_test',
        merchantId: 'merchant-1',
        evidence: {},
        autoSubmit: true,
      });
      expect(result.staged).toBe(false);
    });

    it('throws when merchant has no Stripe account', async () => {
      mockRequireActiveStripeConnection.mockRejectedValueOnce(
        new Error('No active Stripe connection was found for this merchant.'),
      );

      await expect(stripeDisputeService.submitEvidence({
        stripeDisputeId: 'dp_test',
        merchantId: 'merchant-1',
        evidence: {},
        autoSubmit: true,
      })).rejects.toThrow('No active Stripe connection');
    });
  });
});

// ═════════════════════════════════════════════════════════════════════
// EFW MANAGEMENT
// ═════════════════════════════════════════════════════════════════════

describe('EFW Service', () => {
  describe('computeEfwRecommendation', () => {
    it('recommends refund when dispute rate >= 0.6%', () => {
      const rec = stripeEfwService.computeEfwRecommendation(80, 0.007, {});
      expect(rec.action).toBe('refund');
      expect(rec.reason).toContain('VAMP');
    });

    it('recommends hold when evidence >= 60 and rate is low', () => {
      const rec = stripeEfwService.computeEfwRecommendation(75, 0.002, {});
      expect(rec.action).toBe('hold');
      expect(rec.reason).toContain('Strong documentation');
    });

    it('recommends refund when evidence is weak', () => {
      const rec = stripeEfwService.computeEfwRecommendation(30, 0.002, {});
      expect(rec.action).toBe('refund');
      expect(rec.reason).toContain('Consider refunding');
    });

    it('prioritizes dispute rate over evidence score', () => {
      // Even with strong evidence, high dispute rate = refund
      const rec = stripeEfwService.computeEfwRecommendation(90, 0.008, {});
      expect(rec.action).toBe('refund');
    });

    it('boundary: evidence score exactly 60 = hold', () => {
      const rec = stripeEfwService.computeEfwRecommendation(60, 0.001, {});
      expect(rec.action).toBe('hold');
    });

    it('boundary: dispute rate exactly 0.6% = refund', () => {
      const rec = stripeEfwService.computeEfwRecommendation(90, 0.006, {});
      expect(rec.action).toBe('refund');
    });
  });
});
