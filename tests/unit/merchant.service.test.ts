/**
 * Merchant provisioning service tests.
 * Tests pipeline lookup, custom field creation, custom value creation,
 * and the full provisioning orchestrator.
 *
 * Note: Pipeline creation and custom trigger registration do NOT exist
 * in the GHL API. Pipeline comes from Snapshot; triggers are configured
 * in the GHL Marketplace app settings.
 */

// --- Mocks ---
const mockPost = jest.fn();
const mockGet = jest.fn();
const mockPut = jest.fn();

jest.mock('../../src/clients/ghl.client', () => ({
  ghlApi: jest.fn().mockResolvedValue({
    post: mockPost,
    get: mockGet,
    put: mockPut,
  }),
}));

const mockFindByLocationId = jest.fn();
const mockGetByLocationId = jest.fn();
const mockUpdate = jest.fn();
const mockUpdateSnapshotStatus = jest.fn();
const mockRepairProvider = jest.fn();
const mockEnsureWebhookSecret = jest.fn();
const mockClaimProvisioning = jest.fn();
const mockListProvisioningCandidates = jest.fn();
const mockAdoptCompanyAuthorization = jest.fn();

jest.mock('../../src/repositories/merchant.repository', () => ({
  merchantHasOAuthCredentials: (merchant: any) => Boolean(
    merchant?.ghl_access_token_encrypted || merchant?.ghl_access_token,
  ),
  merchantRepository: {
    findByLocationId: mockFindByLocationId,
    getByLocationId: mockGetByLocationId,
    update: mockUpdate,
    updateSnapshotStatus: mockUpdateSnapshotStatus,
    ensureWebhookSecret: mockEnsureWebhookSecret,
    claimProvisioning: mockClaimProvisioning,
    listProvisioningCandidates: mockListProvisioningCandidates,
    adoptCompanyAuthorization: mockAdoptCompanyAuthorization,
  },
}));

jest.mock('../../src/clients/supabase.client', () => ({
  getSupabase: () => ({ from: jest.fn().mockReturnValue({ select: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ single: jest.fn() }) }) }) }),
}));

jest.mock('../../src/services/payment-provider.service', () => ({
  paymentProviderService: {
    repairProvider: (...args: any[]) => mockRepairProvider(...args),
  },
}));

import { merchantService } from '../../src/services/merchant.service';
import { BETA_CUSTOM_FIELD_REGISTRY, CUSTOM_VALUE_REGISTRY } from '../../src/constants/ghl-fields';

let merchantState: any;

beforeEach(() => {
  jest.clearAllMocks();
  merchantState = {
    location_id: 'loc_1',
    config: {},
    snapshot_attempts: 0,
    trigger_ids: {},
    custom_value_ids: {},
    snapshot_status: 'pending',
    status: 'active',
    ghl_access_token_encrypted: 'encrypted-access',
    ghl_refresh_token_encrypted: 'encrypted-refresh',
    updated_at: '2026-07-12T00:00:00.000Z',
  };
  mockGetByLocationId.mockImplementation(async () => merchantState);
  mockUpdate.mockImplementation(async (_locationId: string, updates: any) => {
    merchantState = { ...merchantState, ...updates };
    return merchantState;
  });
  mockUpdateSnapshotStatus.mockResolvedValue(undefined);
  mockRepairProvider.mockResolvedValue(undefined);
  mockEnsureWebhookSecret.mockResolvedValue('webhook-secret');
  mockClaimProvisioning.mockImplementation(async () => ({ ...merchantState, snapshot_status: 'installing' }));
  mockListProvisioningCandidates.mockResolvedValue([]);
  mockAdoptCompanyAuthorization.mockResolvedValue(null);
});

describe('Pipeline Lookup', () => {
  test('finds existing Client Milestones pipeline', async () => {
    mockGet.mockResolvedValueOnce({
      data: { pipelines: [{ id: 'pipe_existing', name: 'Client Milestones' }] },
    });

    const api = { post: mockPost, get: mockGet, put: mockPut } as any;
    const pipelineId = await merchantService.findPipeline(api, 'loc_1');

    expect(pipelineId).toBe('pipe_existing');
  });

  test('returns null if pipeline not found (Snapshot not installed)', async () => {
    mockGet.mockResolvedValueOnce({ data: { pipelines: [] } });

    const api = { post: mockPost, get: mockGet, put: mockPut } as any;
    const pipelineId = await merchantService.findPipeline(api, 'loc_1');

    expect(pipelineId).toBeNull();
  });

  test('returns null on API error (non-fatal)', async () => {
    mockGet.mockRejectedValueOnce(new Error('GHL API down'));

    const api = { post: mockPost, get: mockGet, put: mockPut } as any;
    const pipelineId = await merchantService.findPipeline(api, 'loc_1');

    expect(pipelineId).toBeNull();
  });
});
describe('Custom Fields Creation', () => {
  test('creates only missing fields via v2 endpoint', async () => {
    // Existing fields — 3 of 6 SS fields exist
    mockGet.mockResolvedValueOnce({
      data: {
        customFields: [
          { fieldKey: 'contact.ss_enrollment_status' },
          { fieldKey: 'contact.ss_evidence_score' },
          { fieldKey: 'contact.ss_last_evidence_date' },
        ],
      },
    });
    mockPost.mockResolvedValue({ data: { id: 'field_new' } });

    const api = { post: mockPost, get: mockGet, put: mockPut } as any;
    await merchantService.createCustomFields(api, 'loc_1');

    // 3 existing fields are present; every other approved beta field should be created.
    const createCalls = mockPost.mock.calls.filter(c => c[0] === '/locations/loc_1/customFields');
    expect(createCalls.length).toBe(BETA_CUSTOM_FIELD_REGISTRY.length - 3);
    expect(createCalls[0][1]).toMatchObject({ dataType: expect.any(String) });
  });

  test('skips all if every field exists', async () => {
    const allKeys = BETA_CUSTOM_FIELD_REGISTRY.map((field) => `contact.${field.fieldKey}`);

    mockGet.mockResolvedValueOnce({
      data: { customFields: allKeys.map(k => ({ fieldKey: k })) },
    });

    const api = { post: mockPost, get: mockGet, put: mockPut } as any;
    await merchantService.createCustomFields(api, 'loc_1');

    const createCalls = mockPost.mock.calls.filter(c => c[0] === '/locations/loc_1/customFields');
    expect(createCalls.length).toBe(0);
  });
});

describe('Custom Values Creation', () => {
  test('creates all missing custom values via v2 endpoint (locationId in path)', async () => {
    mockGet.mockResolvedValueOnce({ data: { customValues: [] } });
    mockPost.mockResolvedValue({ data: { id: 'cv_new' } });

    const api = { post: mockPost, get: mockGet, put: mockPut } as any;
    await merchantService.createCustomValues(api, 'loc_1');

    // Verify locationId in path, not body
    const createCalls = mockPost.mock.calls.filter(c => c[0] === '/locations/loc_1/customValues');
    expect(createCalls.length).toBe(CUSTOM_VALUE_REGISTRY.length);
    expect(createCalls[0][1].name).toBe(CUSTOM_VALUE_REGISTRY[0].defaultName);
    expect(createCalls[0][1]).not.toHaveProperty('locationId');
  });

  test('skips existing custom values', async () => {
    const existingValues = CUSTOM_VALUE_REGISTRY.map((entry, idx) => ({
      id: `cv_${idx + 1}`,
      fieldKey: `{{ custom_values.${entry.fieldKeyMatch} }}`,
      value: '',
    }));
    mockGet.mockResolvedValueOnce({
      data: { customValues: existingValues },
    });

    const api = { post: mockPost, get: mockGet, put: mockPut } as any;
    await merchantService.createCustomValues(api, 'loc_1');

    const createCalls = mockPost.mock.calls.filter(c => c[0] === '/locations/loc_1/customValues');
    expect(createCalls.length).toBe(0);
  });
});

describe('Full Provisioning', () => {
  test('provisionMerchant orchestrates all steps and marks installed', async () => {
    // Custom fields — none exist
    mockGet.mockResolvedValueOnce({ data: { customFields: [] } });
    // Custom values — none exist (will be created and IDs stored)
    mockGet.mockResolvedValueOnce({ data: { customValues: [] } });

    // All POST calls succeed
    mockPost.mockResolvedValue({ data: { id: 'new_id' } });

    const result = await merchantService.provisionMerchant('loc_1');

    expect(mockClaimProvisioning).toHaveBeenCalledWith('loc_1', expect.any(Date), 5);
    expect(mockUpdateSnapshotStatus).toHaveBeenCalledWith('loc_1', 'installed');
    expect(result.status).toBe('installed');

    // Client Milestones pipeline is beta-deferred; provisioning stores custom value IDs only.
    expect(mockUpdate).toHaveBeenCalledWith('loc_1', expect.objectContaining({
      custom_value_ids: expect.objectContaining({ WEBHOOK_SECRET: 'new_id' }),
    }));
  });

  test('provisionMerchant marks failed for durable recovery instead of scheduling an in-memory timer', async () => {
    // All GETs fail
    mockGet.mockRejectedValue(new Error('GHL API down'));
    // All POSTs fail
    mockPost.mockRejectedValue(new Error('GHL API down'));

    const result = await merchantService.provisionMerchant('loc_1');

    expect(mockUpdateSnapshotStatus).toHaveBeenCalledWith('loc_1', 'failed', expect.any(String));
    expect(result.status).toBe('failed');
  });

  test('tokenless INSTALL stub waits for OAuth without consuming a provisioning attempt', async () => {
    merchantState.ghl_access_token_encrypted = null;
    merchantState.ghl_refresh_token_encrypted = null;

    const result = await merchantService.provisionMerchant('loc_1');

    expect(result.status).toBe('waiting_for_oauth');
    expect(mockClaimProvisioning).not.toHaveBeenCalled();
  });

  test('recovery sweep retries durable candidates and reports tokenless stubs', async () => {
    const tokenless = {
      ...merchantState,
      location_id: 'loc_waiting',
      ghl_access_token_encrypted: null,
      ghl_refresh_token_encrypted: null,
    };
    mockListProvisioningCandidates.mockResolvedValue([tokenless]);
    mockGetByLocationId.mockResolvedValue(tokenless);

    const result = await merchantService.recoverPendingProvisioning();

    expect(result).toMatchObject({ inspected: 1, waitingForOauth: 1, failed: 0 });
    expect(mockClaimProvisioning).not.toHaveBeenCalled();
  });

  test('tokenless bulk-install stub adopts an existing company authorization', async () => {
    const tokenless = {
      ...merchantState,
      ghl_access_token_encrypted: null,
      ghl_refresh_token_encrypted: null,
      company_id: 'company_1',
    };
    const adopted = {
      ...tokenless,
      ghl_access_token_encrypted: 'encrypted-company-access',
      ghl_refresh_token_encrypted: 'encrypted-company-refresh',
      config: { ghl_token_scope: 'company' },
    };
    merchantState = tokenless;
    mockGetByLocationId.mockResolvedValueOnce(tokenless);
    mockAdoptCompanyAuthorization.mockImplementation(async () => {
      merchantState = adopted;
      return adopted;
    });
    mockClaimProvisioning.mockResolvedValue({ ...adopted, snapshot_status: 'installing' });
    mockGet.mockResolvedValue({ data: { customFields: [], customValues: [] } });
    mockPost.mockResolvedValue({ data: { id: 'new_id' } });

    const result = await merchantService.provisionMerchant('loc_1');

    expect(mockAdoptCompanyAuthorization).toHaveBeenCalledWith('loc_1', 'company_1');
    expect(result.status).toBe('installed');
  });
});

describe('Payment Provider Repair', () => {
  test('registerPaymentProvider repairs provider registration, keys, and GHL connection', async () => {
    await merchantService.registerPaymentProvider('loc_1');

    expect(mockRepairProvider).toHaveBeenCalledWith('loc_1');
  });
});
