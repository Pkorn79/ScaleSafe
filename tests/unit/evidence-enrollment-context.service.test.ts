const repository = {
  findResourceMapping: jest.fn(),
  findEnrollmentContextByRequest: jest.fn(),
  createEnrollmentContext: jest.fn(),
  audit: jest.fn(),
  findEnrollmentContextByTokenHash: jest.fn(),
  claimEnrollmentContext: jest.fn(),
  findSubjectByRef: jest.fn(),
  findSubjectsByIdentity: jest.fn(),
  persistIdentity: jest.fn(),
};

jest.mock('../../src/config', () => ({
  config: {
    appUrl: 'https://dashboard.scalesafe.app',
    evidenceConnectorAutomation: { enabled: true },
  },
}));
jest.mock('../../src/repositories/evidence-connector.repository', () => ({ evidenceConnectorRepository: repository }));
jest.mock('../../src/repositories/offer.repository', () => ({
  offerRepository: { getById: jest.fn() },
}));
jest.mock('../../src/services/merchant.service', () => ({
  merchantService: { getFullConfig: jest.fn() },
}));
jest.mock('../../src/services/offer.service', () => ({
  offerService: { generateEnrollmentLink: jest.fn() },
}));
jest.mock('../../src/utils/field-encryption', () => ({
  encrypt: jest.fn((value: string) => `encrypted:${value}`),
  decrypt: jest.fn((value: string) => value.replace('encrypted:', '')),
}));

import { evidenceEnrollmentContextService } from '../../src/services/evidence-enrollment-context.service';
import { offerRepository } from '../../src/repositories/offer.repository';
import { offerService } from '../../src/services/offer.service';

const auth: any = {
  connection: {
    id: 'conn-1',
    merchant_id: 'merchant-1',
    location_id: 'loc-1',
    connection_type: 'canonical_api',
    setup_status: 'active',
  },
  credential: { key_prefix: 'ss_ev_abcd' },
};

describe('automatic evidence enrollment context', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    repository.findResourceMapping.mockResolvedValue({ offer_id: 'offer-1', approval_status: 'approved' });
    (offerRepository.getById as jest.Mock).mockResolvedValue({
      id: 'offer-1',
      location_id: 'loc-1',
      active: true,
      checkout_mode: 'quick_checkout',
    });
    (offerService.generateEnrollmentLink as jest.Mock).mockReturnValue('https://dashboard.scalesafe.app/quick-checkout?offerId=offer-1');
    repository.findEnrollmentContextByRequest.mockResolvedValue(null);
    repository.findSubjectsByIdentity.mockResolvedValue([]);
    repository.createEnrollmentContext.mockImplementation(async (input: any) => ({ id: 'ctx-1', ...input }));
  });

  it('creates a tenant-bound link without putting external identity in the URL', async () => {
    const result = await evidenceEnrollmentContextService.createEnrollmentLink(auth, {
      request_id: 'request-1',
      external_contact_id: 'customer-456',
      external_enrollment_id: 'purchase-789',
      resource: { type: 'subscription_tier', id: 'tier-pro' },
    });

    expect(result.enrollmentUrl).toContain('evidenceContextToken=ss_ctx_');
    expect(result.enrollmentUrl).not.toContain('customer-456');
    expect(result.enrollmentUrl).not.toContain('purchase-789');
    expect(repository.createEnrollmentContext).toHaveBeenCalledWith(expect.objectContaining({
      connection_id: 'conn-1',
      merchant_id: 'merchant-1',
      location_id: 'loc-1',
      offer_id: 'offer-1',
      external_contact_id: 'customer-456',
      external_enrollment_id: 'purchase-789',
      status: 'pending',
    }));
  });

  it('returns the same active link for an idempotent request', async () => {
    repository.findEnrollmentContextByRequest.mockResolvedValue({
      id: 'ctx-existing',
      status: 'pending',
      expires_at: new Date(Date.now() + 60_000).toISOString(),
      token_encrypted: 'encrypted:ss_ctx_same',
      external_contact_id: 'customer-456',
      external_enrollment_id: 'purchase-789',
      resource_type: 'subscription_tier',
      external_resource_id: 'tier-pro',
      checkout_mode: 'quick_checkout',
    });

    const result = await evidenceEnrollmentContextService.createEnrollmentLink(auth, {
      request_id: 'request-1',
      external_contact_id: 'customer-456',
      external_enrollment_id: 'purchase-789',
      resource: { type: 'subscription_tier', id: 'tier-pro' },
    });

    expect(result.idempotentReplay).toBe(true);
    expect(result.enrollmentUrl).toContain('evidenceContextToken=ss_ctx_same');
    expect(repository.createEnrollmentContext).not.toHaveBeenCalled();
  });

  it('rejects a resource that has not been approved by HQ', async () => {
    repository.findResourceMapping.mockResolvedValue(null);
    await expect(evidenceEnrollmentContextService.createEnrollmentLink(auth, {
      request_id: 'request-1',
      external_contact_id: 'customer-456',
      external_enrollment_id: 'purchase-789',
      resource: { type: 'subscription_tier', id: 'unknown' },
    })).rejects.toThrow('not approved');
  });

  it('checks the stored tenant and offer before atomically claiming the context', async () => {
    repository.findEnrollmentContextByTokenHash.mockResolvedValue({ location_id: 'loc-2', offer_id: 'offer-1' });
    repository.claimEnrollmentContext.mockResolvedValue({
      context_id: 'ctx-1', enrollment_id: 'enrollment-1', location_id: 'loc-2', merchant_id: 'merchant-2', offer_id: 'offer-1', context_status: 'attached',
    });
    const result = await evidenceEnrollmentContextService.claimForCheckout({
      token: 'ss_ctx_token',
      offerId: 'offer-1',
      email: 'client@example.com',
    });
    expect(result.locationId).toBe('loc-2');
    expect(repository.claimEnrollmentContext).toHaveBeenCalled();
  });

  it('binds server identities only through a tenant-scoped enrollment reference', async () => {
    repository.findSubjectByRef.mockResolvedValue({ id: 'subject-1', enrollment_id: 'enrollment-1', offer_id: 'offer-1' });
    const result = await evidenceEnrollmentContextService.bindExistingSubject(auth, {
      enrollment_ref: 'opaque-ref',
      external_contact_id: 'customer-456',
      external_enrollment_id: 'purchase-789',
    });
    expect(result).toMatchObject({ enrollmentId: 'enrollment-1', bound: true });
    expect(repository.findSubjectByRef).toHaveBeenCalledWith('loc-1', 'opaque-ref');
    expect(repository.persistIdentity).toHaveBeenCalledWith(expect.objectContaining({
      connection_id: 'conn-1',
      subject_id: 'subject-1',
      binding_method: 'server_bind',
    }));
  });
});
