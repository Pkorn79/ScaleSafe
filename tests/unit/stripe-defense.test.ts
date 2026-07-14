jest.mock('../../src/clients/supabase.client', () => ({
  getSupabase: () => ({
    from: jest.fn().mockReturnValue({
      insert: jest.fn().mockReturnValue({ select: jest.fn().mockReturnValue({ single: jest.fn().mockResolvedValue({ data: { id: 'test' }, error: null }) }) }),
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          single: jest.fn().mockResolvedValue({ data: null, error: { code: 'PGRST116' } }),
          order: jest.fn().mockReturnValue({
            limit: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({ data: null }),
            }),
          }),
        }),
      }),
      update: jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ error: null }) }),
    }),
  }),
}));

jest.mock('stripe', () => jest.fn(() => ({})));

jest.mock('../../src/config', () => ({
  config: {
    stripe: { secretKey: 'sk_test', publishableKey: 'pk_test', clientId: '', webhookSecret: 'whsec_test' },
    appUrl: 'https://app.scalesafe.com',
    logLevel: 'silent', isDev: true, nodeEnv: 'test',
  },
}));

jest.mock('../../src/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import { stripeEvidenceVaultService } from '../../src/services/stripe-evidence-vault.service';
import { normalizeRiskAuditResult, stripeRiskAuditService } from '../../src/services/stripe-risk-audit.service';

describe('Evidence Vault', () => {
  describe('computeEvidenceScore', () => {
    it('returns 0 for no evidence', () => {
      expect(stripeEvidenceVaultService.computeEvidenceScore({
        hasTermsFile: false, hasContractFile: false, hasSessionLogs: false,
        hasCommunicationFile: false, metadataComplete: false, hasBillingAddress: false,
      })).toBe(0);
    });

    it('returns 15 for metadata only', () => {
      expect(stripeEvidenceVaultService.computeEvidenceScore({
        hasTermsFile: false, hasContractFile: false, hasSessionLogs: false,
        hasCommunicationFile: false, metadataComplete: true, hasBillingAddress: false,
      })).toBe(15);
    });

    it('returns 25 for metadata + billing address', () => {
      expect(stripeEvidenceVaultService.computeEvidenceScore({
        hasTermsFile: false, hasContractFile: false, hasSessionLogs: false,
        hasCommunicationFile: false, metadataComplete: true, hasBillingAddress: true,
      })).toBe(25);
    });

    it('returns 55 for terms + contract + metadata', () => {
      expect(stripeEvidenceVaultService.computeEvidenceScore({
        hasTermsFile: true, hasContractFile: true, hasSessionLogs: false,
        hasCommunicationFile: false, metadataComplete: true, hasBillingAddress: false,
      })).toBe(55);
    });

    it('returns 100 for complete evidence', () => {
      expect(stripeEvidenceVaultService.computeEvidenceScore({
        hasTermsFile: true, hasContractFile: true, hasSessionLogs: true,
        hasCommunicationFile: true, metadataComplete: true, hasBillingAddress: true,
      })).toBe(100);
    });
  });
});

describe('Risk Audit Scores', () => {
  it('normalizes stored snake_case audit rows for the frontend contract', () => {
    expect(normalizeRiskAuditResult({
      id: 'audit_1',
      merchant_id: 'merchant_1',
      created_at: '2026-07-14T10:00:00Z',
      audit_period_start: '2026-04-15T10:00:00Z',
      audit_period_end: '2026-07-14T10:00:00Z',
      total_charges: 25,
      total_disputes: 2,
      total_efws: 1,
      score_dispute_rate: 60,
      overall_risk_level: 'elevated',
      module_recommendations: [{ module: 'radar', priority: 'high', reason: 'Test', metric: '8%' }],
    })).toEqual(expect.objectContaining({
      merchantId: 'merchant_1',
      totalCharges: 25,
      totalDisputes: 2,
      totalEfws: 1,
      scoreDisputeRate: 60,
      overallRiskLevel: 'elevated',
      moduleRecommendations: [{ module: 'radar', priority: 'high', reason: 'Test', metric: '8%' }],
    }));
  });

  describe('computeDisputeRateScore', () => {
    it('returns 100 for 0 disputes', () => {
      expect(stripeRiskAuditService.computeDisputeRateScore(0, 100)).toBe(100);
    });

    it('returns 100 for 0 charges', () => {
      expect(stripeRiskAuditService.computeDisputeRateScore(0, 0)).toBe(100);
    });

    it('returns 80 for rate under 0.4%', () => {
      expect(stripeRiskAuditService.computeDisputeRateScore(3, 1000)).toBe(80);
    });

    it('returns 60 for rate 0.4-0.65%', () => {
      expect(stripeRiskAuditService.computeDisputeRateScore(5, 1000)).toBe(60);
    });

    it('returns 40 for rate 0.65-0.75%', () => {
      expect(stripeRiskAuditService.computeDisputeRateScore(7, 1000)).toBe(40);
    });

    it('returns 20 for rate 0.75-0.9%', () => {
      expect(stripeRiskAuditService.computeDisputeRateScore(8, 1000)).toBe(20);
    });

    it('returns 0 for rate above 0.9%', () => {
      expect(stripeRiskAuditService.computeDisputeRateScore(10, 1000)).toBe(0);
    });
  });

  describe('computeRepeatClientRateScore', () => {
    it('returns 100 for >50% repeat', () => {
      expect(stripeRiskAuditService.computeRepeatClientRateScore(60, 100)).toBe(100);
    });

    it('returns 80 for 30-50% repeat', () => {
      expect(stripeRiskAuditService.computeRepeatClientRateScore(40, 100)).toBe(80);
    });

    it('returns 40 for 5-15% repeat', () => {
      expect(stripeRiskAuditService.computeRepeatClientRateScore(10, 100)).toBe(40);
    });

    it('returns 0 for no customers', () => {
      expect(stripeRiskAuditService.computeRepeatClientRateScore(0, 0)).toBe(0);
    });
  });

  describe('computeRadarDataQualityScore', () => {
    it('returns 100 when >80% have IP and email', () => {
      const pis = Array(10).fill(null).map(() => ({
        metadata: { customer_ip: '1.2.3.4' },
        receipt_email: 'test@test.com',
      }));
      expect(stripeRiskAuditService.computeRadarDataQualityScore(pis)).toBe(100);
    });

    it('returns 0 for empty PIs', () => {
      expect(stripeRiskAuditService.computeRadarDataQualityScore([])).toBe(0);
    });

    it('returns 50 for IP only', () => {
      const pis = Array(10).fill(null).map(() => ({
        metadata: { customer_ip: '1.2.3.4' },
      }));
      expect(stripeRiskAuditService.computeRadarDataQualityScore(pis)).toBe(50);
    });
  });

  describe('generateModuleRecommendations', () => {
    it('recommends visa shield for high dispute rate', () => {
      const recs = stripeRiskAuditService.generateModuleRecommendations(0.008, 80, 100, 50, 100, 100);
      expect(recs.find(r => r.module === 'visa_pre_dispute_shield')).toBeDefined();
      expect(recs.find(r => r.module === 'visa_pre_dispute_shield')!.priority).toBe('critical');
    });

    it('recommends evidence vault for low evidence score', () => {
      const recs = stripeRiskAuditService.generateModuleRecommendations(0, 40, 100, 0, 100, 100);
      expect(recs.find(r => r.module === 'evidence_vault')).toBeDefined();
    });

    it('recommends CE 3.0 for high repeat rate', () => {
      const recs = stripeRiskAuditService.generateModuleRecommendations(0, 80, 100, 40, 100, 100);
      expect(recs.find(r => r.module === 'ce30_blocking')).toBeDefined();
    });

    it('returns empty for perfect scores with low repeat rate', () => {
      const recs = stripeRiskAuditService.generateModuleRecommendations(0, 80, 100, 5, 100, 100);
      expect(recs.length).toBe(0);
    });
  });
});
