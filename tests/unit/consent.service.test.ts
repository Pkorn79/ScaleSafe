const mockEnrollmentCreate = jest.fn();
const mockEvidenceCreate = jest.fn();
const mockOfferFindById = jest.fn();
const mockMerchantFindByLocationId = jest.fn();

jest.mock('../../src/clients/supabase.client', () => ({
  getSupabase: () => ({}),
}));

jest.mock('../../src/repositories/enrollment.repository', () => ({
  enrollmentRepository: {
    create: (...args: any[]) => mockEnrollmentCreate(...args),
  },
}));

jest.mock('../../src/repositories/phase2Evidence.repository', () => ({
  phase2EvidenceRepository: {
    create: (...args: any[]) => mockEvidenceCreate(...args),
  },
}));

jest.mock('../../src/repositories/offer.repository', () => ({
  offerRepository: {
    findById: (...args: any[]) => mockOfferFindById(...args),
  },
}));

jest.mock('../../src/repositories/merchant.repository', () => ({
  merchantRepository: {
    findByLocationId: (...args: any[]) => mockMerchantFindByLocationId(...args),
  },
}));

import { consentService } from '../../src/services/consent.service';

beforeEach(() => {
  jest.clearAllMocks();
  mockOfferFindById.mockResolvedValue({
    id: 'offer_1',
    offer_name: 'Test Program',
    active: true,
    location_id: 'loc_1',
  });
  mockMerchantFindByLocationId.mockResolvedValue({ id: 'merchant_1' });
  mockEnrollmentCreate.mockResolvedValue({
    id: 'enrollment_1',
    consent_token: 'token_abc',
    status: 'consent_captured',
  });
  mockEvidenceCreate.mockResolvedValue({ id: 'ev_1' });
});

describe('Consent Service', () => {
  const baseParams = {
    offerId: 'offer_1',
    locationId: 'loc_1',
    contactId: 'contact_1',
    contactEmail: 'john@test.com',
    contactName: 'John Smith',
    ip: '1.2.3.4',
    device: 'desktop',
    browser: 'Chrome',
    tcVersionHash: 'hash_abc',
    signatureText: 'John Smith',
  };

  test('creates enrollment with consent_captured status', async () => {
    const result = await consentService.captureConsent(baseParams);

    expect(result.enrollmentId).toBe('enrollment_1');
    expect(result.consentToken).toBeDefined();
    expect(mockEnrollmentCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        location_id: 'loc_1',
        contact_id: 'contact_1',
        offer_id: 'offer_1',
        status: 'consent_captured',
        consent_ip: '1.2.3.4',
      }),
    );
  });

  test('logs enrollment_consent evidence', async () => {
    await consentService.captureConsent(baseParams);

    expect(mockEvidenceCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        location_id: 'loc_1',
        contact_id: 'contact_1',
        enrollment_id: 'enrollment_1',
        evidence_type: 'enrollment_consent',
        data: expect.objectContaining({
          signature_text: 'John Smith',
          tc_version_hash: 'hash_abc',
          offer_name: 'Test Program',
        }),
        ip_address: '1.2.3.4',
      }),
    );
  });

  test('throws for inactive offer', async () => {
    mockOfferFindById.mockResolvedValue({ id: 'offer_1', active: false });

    await expect(consentService.captureConsent(baseParams)).rejects.toThrow('Offer not found or inactive');
  });

  test('throws for missing offer', async () => {
    mockOfferFindById.mockResolvedValue(null);

    await expect(consentService.captureConsent(baseParams)).rejects.toThrow('Offer not found or inactive');
  });

  test('handles missing merchant gracefully', async () => {
    mockMerchantFindByLocationId.mockResolvedValue(null);

    const result = await consentService.captureConsent(baseParams);
    expect(result.enrollmentId).toBe('enrollment_1');
    expect(mockEnrollmentCreate).toHaveBeenCalledWith(
      expect.objectContaining({ merchant_id: null }),
    );
  });
});
