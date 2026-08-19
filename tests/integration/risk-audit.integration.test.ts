/**
 * Integration test: Risk Audit scoring and module recommendations.
 * Tests the scoring algorithms and recommendation engine without hitting Stripe.
 */

jest.mock('../../src/clients/supabase.client', () => ({
  getSupabase: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            single: () => ({ data: null, error: null }),
          }),
          order: () => ({
            limit: () => ({
              single: () => ({ data: null, error: null }),
            }),
          }),
        }),
      }),
      insert: () => ({
        select: () => ({
          single: () => ({ data: { id: 'audit_1' }, error: null }),
        }),
      }),
    }),
  }),
}));

jest.mock('stripe', () => {
  return jest.fn(() => ({}));
});

jest.mock('../../src/config', () => ({
  config: {
    stripe: { secretKey: 'sk_test_fake', publishableKey: 'pk_test_fake', webhookSecret: '', clientId: '', liveMode: false },
    appUrl: 'http://localhost:3000',
    logLevel: 'silent',
    isDev: true,
  },
}));

jest.mock('../../src/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import { stripeRiskAuditService, customerPresentPaymentIntents } from '../../src/services/stripe-risk-audit.service';

describe('Risk Audit Integration', () => {

  describe('Dispute Rate Scoring', () => {
    it('should score 100 for zero disputes', () => {
      expect(stripeRiskAuditService.computeDisputeRateScore(0, 1000)).toBe(100);
    });

    it('should score 100 when no charges exist', () => {
      expect(stripeRiskAuditService.computeDisputeRateScore(0, 0)).toBe(100);
    });

    it('should score 80 for rate below 0.4%', () => {
      // 3 disputes / 1000 charges = 0.3%
      expect(stripeRiskAuditService.computeDisputeRateScore(3, 1000)).toBe(80);
    });

    it('should score 60 for rate between 0.4% and 0.65%', () => {
      // 5 disputes / 1000 charges = 0.5%
      expect(stripeRiskAuditService.computeDisputeRateScore(5, 1000)).toBe(60);
    });

    it('should score 40 for rate between 0.65% and 0.75%', () => {
      // 7 disputes / 1000 charges = 0.7%
      expect(stripeRiskAuditService.computeDisputeRateScore(7, 1000)).toBe(40);
    });

    it('should score 20 for rate between 0.75% and 0.9%', () => {
      // 8 disputes / 1000 charges = 0.8%
      expect(stripeRiskAuditService.computeDisputeRateScore(8, 1000)).toBe(20);
    });

    it('should score 0 for rate above 0.9%', () => {
      // 10 disputes / 1000 charges = 1.0%
      expect(stripeRiskAuditService.computeDisputeRateScore(10, 1000)).toBe(0);
    });
  });

  describe('Evidence Readiness Scoring', () => {
    it('scores 100 (no false alarm) when there are no customer-present payment intents', () => {
      // A recurring-only billing window has nothing measurable missing —
      // merchant-initiated charges can never carry session IP/email.
      expect(stripeRiskAuditService.computeEvidenceReadinessScore([], [])).toBe(100);
    });

    it('should score high for well-instrumented PIs', () => {
      const pis = Array(10).fill(null).map(() => ({
        receipt_email: 'test@example.com',
        description: 'Coaching Program',
        metadata: { customer_ip: '1.2.3.4', customer_email: 'test@example.com' },
        customer: 'cus_test',
      }));

      const score = stripeRiskAuditService.computeEvidenceReadinessScore(pis, []);
      expect(score).toBeGreaterThanOrEqual(80);
    });

    it('should score lower when metadata is missing', () => {
      const pis = Array(10).fill(null).map(() => ({
        receipt_email: null,
        description: null,
        metadata: {},
        customer: null,
      }));

      const score = stripeRiskAuditService.computeEvidenceReadinessScore(pis, []);
      expect(score).toBeLessThan(40);
    });
  });

  describe('Repeat Client Rate Scoring', () => {
    it('should score 100 for >50% repeat rate', () => {
      expect(stripeRiskAuditService.computeRepeatClientRateScore(60, 100)).toBe(100);
    });

    it('should score 0 for zero unique customers', () => {
      expect(stripeRiskAuditService.computeRepeatClientRateScore(0, 0)).toBe(0);
    });

    it('should score 20 for very low repeat rate', () => {
      expect(stripeRiskAuditService.computeRepeatClientRateScore(2, 100)).toBe(20);
    });
  });

  describe('Radar Data Quality Scoring', () => {
    it('should score 100 for complete IP and email data', () => {
      const pis = Array(10).fill(null).map(() => ({
        receipt_email: 'test@example.com',
        metadata: { customer_ip: '1.2.3.4', customer_email: 'test@example.com' },
      }));

      expect(stripeRiskAuditService.computeRadarDataQualityScore(pis)).toBe(100);
    });

    it('should score 0 for missing data', () => {
      const pis = Array(10).fill(null).map(() => ({
        receipt_email: null,
        metadata: {},
      }));

      expect(stripeRiskAuditService.computeRadarDataQualityScore(pis)).toBe(0);
    });

    it('scores 100 (no false alarm) when there are no customer-present payment intents', () => {
      expect(stripeRiskAuditService.computeRadarDataQualityScore([])).toBe(100);
    });
  });

  describe('Customer-present transaction filtering', () => {
    it('excludes Stripe-billed subscription invoice PIs from data-quality scoring', () => {
      const checkoutPI = {
        id: 'pi_checkout',
        invoice: null,
        status: 'succeeded',
        receipt_email: 'client@example.com',
        metadata: { customer_ip: '1.2.3.4', customer_email: 'client@example.com' },
      };
      const abandonedPI = {
        id: 'pi_abandoned',
        invoice: null,
        status: 'requires_payment_method',
        receipt_email: null,
        metadata: {},
      };
      const subscriptionPIs = Array(8).fill(null).map((_, i) => ({
        id: `pi_recurring_${i}`,
        invoice: `in_${i}`,
        status: 'succeeded',
        receipt_email: null,
        metadata: {},
      }));

      const filtered = customerPresentPaymentIntents([checkoutPI, abandonedPI, ...subscriptionPIs]);
      expect(filtered).toEqual([checkoutPI]);

      // A recurring-heavy merchant with a fully instrumented checkout must not
      // score 0/100 because Stripe-billed installments lack session data.
      expect(stripeRiskAuditService.computeRadarDataQualityScore(filtered)).toBe(100);
    });
  });

  describe('Module Recommendations', () => {
    it('should recommend visa_pre_dispute_shield for high dispute rate', () => {
      const recs = stripeRiskAuditService.generateModuleRecommendations(
        0.008, // 0.8% dispute rate — above VAMP threshold
        80, 80, 10, 100, 80,
      );

      const visaRec = recs.find(r => r.module === 'visa_pre_dispute_shield');
      expect(visaRec).toBeDefined();
      expect(visaRec!.priority).toBe('critical');
    });

    it('should recommend evidence_vault for low evidence readiness', () => {
      const recs = stripeRiskAuditService.generateModuleRecommendations(
        0.001, 40, 80, 10, 100, 80,
      );

      const vaultRec = recs.find(r => r.module === 'evidence_vault');
      expect(vaultRec).toBeDefined();
      expect(vaultRec!.priority).toBe('high');
    });

    it('should recommend statement_descriptors for poor descriptor quality', () => {
      const recs = stripeRiskAuditService.generateModuleRecommendations(
        0.001, 80, 30, 10, 100, 80,
      );

      const descRec = recs.find(r => r.module === 'statement_descriptors');
      expect(descRec).toBeDefined();
      expect(descRec!.priority).toBe('medium');
    });

    it('should recommend ce30_blocking for high repeat client rate', () => {
      const recs = stripeRiskAuditService.generateModuleRecommendations(
        0.001, 80, 80, 40, 100, 80,
      );

      const ceRec = recs.find(r => r.module === 'ce30_blocking');
      expect(ceRec).toBeDefined();
      // CE 3.0 qualification is good news — surfaced as a green strength, not an alert.
      expect(ceRec!.priority).toBe('strength');
    });

    it('should recommend radar_enrichment for low radar quality', () => {
      const recs = stripeRiskAuditService.generateModuleRecommendations(
        0.001, 80, 80, 10, 100, 30,
      );

      const radarRec = recs.find(r => r.module === 'radar_enrichment');
      expect(radarRec).toBeDefined();
      expect(radarRec!.priority).toBe('medium');
    });

    it('should return no recommendations for a healthy merchant', () => {
      const recs = stripeRiskAuditService.generateModuleRecommendations(
        0.001, // low dispute rate
        80,    // good evidence
        80,    // good descriptors
        5,     // few repeat clients (<30%)
        100,   // but that's ok
        80,    // good radar data
      );

      // Should not have critical/high recs
      const criticalRecs = recs.filter(r => r.priority === 'critical');
      expect(criticalRecs).toHaveLength(0);
    });
  });

  describe('Evidence Vault Scoring', () => {
    // Import evidence vault service for score computation
    let computeEvidenceScore: any;

    beforeAll(() => {
      // Use dynamic import to get the function after mocks are set up
      const { stripeEvidenceVaultService } = require('../../src/services/stripe-evidence-vault.service');
      computeEvidenceScore = stripeEvidenceVaultService.computeEvidenceScore;
    });

    it('should score 100 for complete evidence', () => {
      const score = computeEvidenceScore({
        hasTermsFile: true,
        hasContractFile: true,
        hasSessionLogs: true,
        hasCommunicationFile: true,
        metadataComplete: true,
        hasBillingAddress: true,
      });
      expect(score).toBe(100);
    });

    it('should score 0 for no evidence', () => {
      const score = computeEvidenceScore({
        hasTermsFile: false,
        hasContractFile: false,
        hasSessionLogs: false,
        hasCommunicationFile: false,
        metadataComplete: false,
        hasBillingAddress: false,
      });
      expect(score).toBe(0);
    });

    it('should score 25 for metadata + billing only', () => {
      const score = computeEvidenceScore({
        hasTermsFile: false,
        hasContractFile: false,
        hasSessionLogs: false,
        hasCommunicationFile: false,
        metadataComplete: true,
        hasBillingAddress: true,
      });
      expect(score).toBe(25);
    });
  });
});
