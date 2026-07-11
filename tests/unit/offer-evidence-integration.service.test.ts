const repository = {
  getConnection: jest.fn(),
  findResourceMapping: jest.fn(),
};
const catalogRepository = {
  getPrimaryOfferIntegration: jest.fn(),
  clearPrimaryOfferIntegration: jest.fn(),
  savePrimaryOfferIntegration: jest.fn(),
};

jest.mock('../../src/repositories/evidence-connector.repository', () => ({ evidenceConnectorRepository: repository }));
jest.mock('../../src/repositories/integration-catalog.repository', () => ({ integrationCatalogRepository: catalogRepository }));
jest.mock('../../src/repositories/offer.repository', () => ({ offerRepository: { getById: jest.fn().mockResolvedValue({ id: 'offer-1' }) } }));

import { offerEvidenceIntegrationService } from '../../src/services/offer-evidence-integration.service';

describe('offer evidence integration policy', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    repository.getConnection.mockResolvedValue({
      id: 'connection-1', location_id: 'loc-1', status: 'active', setup_status: 'active',
      provider_key: 'teachable', connection_type: 'provider_adapter', provider_capabilities: ['evidence', 'native_purchases', 'access_management'],
    });
    repository.findResourceMapping.mockResolvedValue({
      offer_id: 'offer-1', approval_status: 'approved', external_resource_name: 'Course A',
    });
    catalogRepository.savePrimaryOfferIntegration.mockResolvedValue({ id: 'integration-1' });
  });

  it('saves a tenant-scoped managed-access policy for an approved resource', async () => {
    await offerEvidenceIntegrationService.save('loc-1', 'offer-1', 'merchant@example.com', {
      accessMode: 'scalesafe_checkout_managed_access',
      connectionId: 'connection-1', resourceType: 'course', resourceId: 'course-1', resourceName: 'Course A',
      gracePeriodDays: 10, revokeOnCancellation: true, revokeOnFullRefund: true,
    });
    expect(catalogRepository.savePrimaryOfferIntegration).toHaveBeenCalledWith(expect.objectContaining({
      p_location_id: 'loc-1', p_offer_id: 'offer-1', p_provider_key: 'teachable',
      p_access_mode: 'scalesafe_checkout_managed_access', p_grace_period_days: 10,
    }));
  });

  it('rejects access management when the provider does not support it', async () => {
    repository.getConnection.mockResolvedValue({
      id: 'connection-1', status: 'active', setup_status: 'active', provider_key: 'zoom',
      connection_type: 'provider_adapter', provider_capabilities: ['evidence', 'attendance'],
    });
    await expect(offerEvidenceIntegrationService.save('loc-1', 'offer-1', 'merchant@example.com', {
      accessMode: 'scalesafe_checkout_managed_access', connectionId: 'connection-1', resourceType: 'meeting', resourceId: 'meeting-1',
    })).rejects.toThrow('does not support');
  });

  it('clears the primary integration without altering the offer', async () => {
    await offerEvidenceIntegrationService.save('loc-1', 'offer-1', 'merchant@example.com', { accessMode: 'none' });
    expect(catalogRepository.clearPrimaryOfferIntegration).toHaveBeenCalledWith('loc-1', 'offer-1');
    expect(repository.getConnection).not.toHaveBeenCalled();
  });
});
