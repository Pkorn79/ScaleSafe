/**
 * Stripe Prevention Service tests — Phase S4
 *
 * Tests OI enrollment checklist, CE 3.0 readiness detection,
 * and prevention coverage aggregation.
 */

jest.mock('stripe', () => jest.fn(() => ({})));

const mockFrom = jest.fn();
jest.mock('../../src/clients/supabase.client', () => ({
  getSupabase: () => ({ from: mockFrom }),
}));

jest.mock('../../src/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

import { StripePreventionService } from '../../src/services/stripe-prevention.service';

describe('StripePreventionService', () => {
  let service: StripePreventionService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new StripePreventionService();
  });

  describe('getOiEnrollmentChecklist', () => {
    it('returns correct steps with Stripe connected', async () => {
      // Mock merchant query (stripe_connected)
      mockFrom.mockReturnValueOnce({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({
                data: { stripe_connected: true },
                error: null,
              }),
            }),
          }),
        }),
      });

      // Mock CE 3.0 readiness (stripe_evidence_vault)
      mockFrom.mockReturnValueOnce({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              order: jest.fn().mockReturnValue({
                limit: jest.fn().mockResolvedValue({
                  data: [
                    { customer_ip: '1.2.3.4', customer_email: 'a@b.com', offer_description: 'Test', ce30_fields_complete: true },
                    { customer_ip: '1.2.3.5', customer_email: 'c@d.com', offer_description: 'Test2', ce30_fields_complete: true },
                  ],
                  error: null,
                }),
              }),
            }),
          }),
        }),
      });

      // Mock risk_audit_results
      mockFrom.mockReturnValueOnce({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            order: jest.fn().mockReturnValue({
              limit: jest.fn().mockReturnValue({
                single: jest.fn().mockResolvedValue({
                  data: { repeat_customer_count: 20, unique_customer_count: 100, score_repeat_client_rate: 20 },
                  error: null,
                }),
              }),
            }),
          }),
        }),
      });

      const checklist = await service.getOiEnrollmentChecklist('merchant_1', 'loc_1');

      expect(checklist.module).toBe('Order Insights (OI)');
      expect(checklist.network).toBe('Visa');
      expect(checklist.steps).toHaveLength(4);
      expect(checklist.steps[0].id).toBe('stripe_connected');
      expect(checklist.steps[0].complete).toBe(true);
      expect(checklist.overallProgress).toBeGreaterThan(0);
    });

    it('marks Stripe disconnected correctly', async () => {
      // Merchant with no Stripe
      mockFrom.mockReturnValueOnce({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({
                data: { stripe_connected: false },
                error: null,
              }),
            }),
          }),
        }),
      });

      // CE 3.0: no entries
      mockFrom.mockReturnValueOnce({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              order: jest.fn().mockReturnValue({
                limit: jest.fn().mockResolvedValue({ data: [], error: null }),
              }),
            }),
          }),
        }),
      });

      // risk_audit_results: none
      mockFrom.mockReturnValueOnce({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            order: jest.fn().mockReturnValue({
              limit: jest.fn().mockReturnValue({
                single: jest.fn().mockResolvedValue({ data: null, error: null }),
              }),
            }),
          }),
        }),
      });

      const checklist = await service.getOiEnrollmentChecklist('merchant_1', 'loc_1');
      expect(checklist.steps[0].complete).toBe(false);
    });
  });

  describe('checkCe30Readiness', () => {
    it('detects missing fields when IP is absent', async () => {
      mockFrom.mockReturnValueOnce({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              order: jest.fn().mockReturnValue({
                limit: jest.fn().mockResolvedValue({
                  data: [
                    { customer_ip: null, customer_email: 'a@b.com', offer_description: 'Test', ce30_fields_complete: false },
                    { customer_ip: null, customer_email: 'c@d.com', offer_description: 'Test2', ce30_fields_complete: false },
                    { customer_ip: null, customer_email: 'd@e.com', offer_description: 'Test3', ce30_fields_complete: false },
                    { customer_ip: null, customer_email: 'f@g.com', offer_description: 'Test4', ce30_fields_complete: false },
                    { customer_ip: null, customer_email: 'h@i.com', offer_description: 'Test5', ce30_fields_complete: false },
                  ],
                  error: null,
                }),
              }),
            }),
          }),
        }),
      });

      const readiness = await service.checkCe30Readiness('merchant_1', 'loc_1');

      expect(readiness.complete).toBe(false);
      expect(readiness.missing.length).toBeGreaterThan(0);
      expect(readiness.missing[0]).toContain('IP address');
    });

    it('returns complete when all fields present', async () => {
      const fullEntries = Array.from({ length: 5 }, () => ({
        customer_ip: '1.2.3.4',
        customer_email: 'a@b.com',
        offer_description: 'Test',
        ce30_fields_complete: true,
      }));

      mockFrom.mockReturnValueOnce({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              order: jest.fn().mockReturnValue({
                limit: jest.fn().mockResolvedValue({ data: fullEntries, error: null }),
              }),
            }),
          }),
        }),
      });

      const readiness = await service.checkCe30Readiness('merchant_1', 'loc_1');

      expect(readiness.complete).toBe(true);
      expect(readiness.missing).toHaveLength(0);
      expect(readiness.eligibleTransactionPercent).toBe(100);
    });

    it('returns incomplete when no transactions found', async () => {
      mockFrom.mockReturnValueOnce({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              order: jest.fn().mockReturnValue({
                limit: jest.fn().mockResolvedValue({ data: [], error: null }),
              }),
            }),
          }),
        }),
      });

      const readiness = await service.checkCe30Readiness('merchant_1', 'loc_1');

      expect(readiness.complete).toBe(false);
      expect(readiness.missing).toContain('No transactions found');
      expect(readiness.eligibleTransactionPercent).toBe(0);
    });
  });

  describe('getPreventionCoverage', () => {
    it('aggregates all three checklists', async () => {
      // Build a reusable mock that handles all the query chain patterns
      const makeMerchantQuery = () => ({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({
                data: { stripe_connected: true },
                error: null,
              }),
            }),
          }),
        }),
      });

      const makeVaultQuery = () => ({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              order: jest.fn().mockReturnValue({
                limit: jest.fn().mockResolvedValue({ data: [], error: null }),
              }),
            }),
          }),
        }),
      });

      const makeAuditQuery = () => ({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            order: jest.fn().mockReturnValue({
              limit: jest.fn().mockReturnValue({
                single: jest.fn().mockResolvedValue({ data: null, error: null }),
              }),
            }),
          }),
        }),
      });

      // OI needs: merchant, vault (ce30), audit
      // RDR needs: merchant
      // Ethoca needs: merchant
      // Promise.all runs them concurrently but mockFrom calls are sequential
      mockFrom
        .mockReturnValueOnce(makeMerchantQuery())  // OI: merchant
        .mockReturnValueOnce(makeMerchantQuery())  // RDR: merchant
        .mockReturnValueOnce(makeMerchantQuery())  // Ethoca: merchant
        .mockReturnValueOnce(makeVaultQuery())     // OI: ce30 vault
        .mockReturnValueOnce(makeAuditQuery());    // OI: risk audit

      const coverage = await service.getPreventionCoverage('merchant_1', 'loc_1');

      expect(coverage.visa.oi).toBeDefined();
      expect(coverage.visa.rdr).toBeDefined();
      expect(coverage.mastercard.ethoca).toBeDefined();
      expect(typeof coverage.overallCoverage).toBe('number');
      expect(coverage.overallCoverage).toBeGreaterThanOrEqual(0);
      expect(coverage.overallCoverage).toBeLessThanOrEqual(100);
    });
  });
});
