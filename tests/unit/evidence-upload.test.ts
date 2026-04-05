jest.mock('stripe', () => jest.fn(() => ({
  files: { create: jest.fn().mockResolvedValue({ id: 'file_test123' }) },
})));

jest.mock('../../src/clients/supabase.client', () => ({
  getSupabase: () => ({
    from: jest.fn().mockReturnValue({
      insert: jest.fn().mockReturnValue({ select: jest.fn().mockReturnValue({ single: jest.fn().mockResolvedValue({ data: { id: 'entry_1' }, error: null }) }) }),
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          single: jest.fn().mockResolvedValue({ data: null }),
          eq: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({ data: null }),
          }),
        }),
      }),
      update: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            eq: jest.fn().mockResolvedValue({ error: null }),
          }),
        }),
      }),
    }),
    rpc: jest.fn().mockResolvedValue({ error: null }),
  }),
}));

jest.mock('../../src/config', () => ({
  config: {
    stripe: { secretKey: 'sk_test', publishableKey: 'pk_test', clientId: '', webhookSecret: '' },
    appUrl: 'https://app.scalesafe.com',
    logLevel: 'silent', isDev: true, nodeEnv: 'test',
  },
}));

jest.mock('../../src/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import { stripeEvidenceVaultService } from '../../src/services/stripe-evidence-vault.service';

describe('Evidence File Upload (S2)', () => {
  describe('generateOfferTermsPdf', () => {
    it('generates a valid PDF buffer', async () => {
      const buf = await stripeEvidenceVaultService.generateOfferTermsPdf({
        offerTitle: 'Test Program',
        offerDescription: 'A test coaching program',
        refundPolicy: '30-day money back guarantee',
        tcClauses: ['No refunds after 30 days', 'Service delivered as described'],
        pricing: { type: 'installments', amount: 50000, installments: 12 },
      });

      expect(buf).toBeInstanceOf(Buffer);
      expect(buf.length).toBeGreaterThan(100);
      // PDF magic bytes
      expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
    });

    it('handles empty optional fields', async () => {
      const buf = await stripeEvidenceVaultService.generateOfferTermsPdf({
        offerTitle: '',
        offerDescription: '',
        refundPolicy: '',
        tcClauses: [],
        pricing: { type: 'pif', amount: 100000 },
      });

      expect(buf).toBeInstanceOf(Buffer);
      expect(buf.length).toBeGreaterThan(100);
    });
  });

  describe('generateSessionLogPdf', () => {
    it('generates a valid session log PDF', async () => {
      const buf = await stripeEvidenceVaultService.generateSessionLogPdf({
        sessionDate: '2026-04-03',
        sessionType: 'coaching_call',
        sessionNotes: 'Discussed business strategy and set Q2 goals',
        durationMinutes: 60,
      });

      expect(buf).toBeInstanceOf(Buffer);
      expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
    });
  });

  describe('generateCommunicationPdf', () => {
    it('generates a valid communication trail PDF', async () => {
      const buf = await stripeEvidenceVaultService.generateCommunicationPdf({
        communicationType: 'email',
        messages: [
          { date: '2026-03-01', from: 'coach@biz.com', to: 'client@email.com', content: 'Welcome to the program!' },
          { date: '2026-03-15', from: 'client@email.com', to: 'coach@biz.com', content: 'Thanks for the great session!' },
        ],
      });

      expect(buf).toBeInstanceOf(Buffer);
      expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
    });
  });

  describe('getEvidenceGaps', () => {
    it('returns all gaps for empty entry', () => {
      const gaps = stripeEvidenceVaultService.getEvidenceGaps({
        terms_file_id: null,
        contract_file_id: null,
        session_file_ids: [],
        communication_file_id: null,
        ce30_fields_complete: false,
        customer_billing_address: null,
      });

      expect(gaps).toContain('Offer terms document not uploaded');
      expect(gaps).toContain('Signed contract not uploaded');
      expect(gaps).toContain('No session/delivery logs uploaded');
      expect(gaps).toContain('No communication trail uploaded');
      expect(gaps).toContain('CE 3.0 fields incomplete (missing IP, email, or description)');
      expect(gaps).toContain('Customer billing address not captured');
      expect(gaps).toHaveLength(6);
    });

    it('returns empty array for complete entry', () => {
      const gaps = stripeEvidenceVaultService.getEvidenceGaps({
        terms_file_id: 'file_1',
        contract_file_id: 'file_2',
        session_file_ids: ['file_3'],
        communication_file_id: 'file_4',
        ce30_fields_complete: true,
        customer_billing_address: { city: 'NYC' },
      });

      expect(gaps).toHaveLength(0);
    });

    it('returns specific gaps for partial entry', () => {
      const gaps = stripeEvidenceVaultService.getEvidenceGaps({
        terms_file_id: 'file_1',
        contract_file_id: null,
        session_file_ids: ['file_2'],
        communication_file_id: null,
        ce30_fields_complete: true,
        customer_billing_address: { city: 'LA' },
      });

      expect(gaps).toHaveLength(2);
      expect(gaps).toContain('Signed contract not uploaded');
      expect(gaps).toContain('No communication trail uploaded');
    });

    it('returns error message for null entry', () => {
      const gaps = stripeEvidenceVaultService.getEvidenceGaps(null);
      expect(gaps).toEqual(['No evidence vault entry found for this transaction']);
    });
  });
});
