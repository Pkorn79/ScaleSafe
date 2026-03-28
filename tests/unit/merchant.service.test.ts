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

jest.mock('../../src/repositories/merchant.repository', () => ({
  merchantRepository: {
    findByLocationId: mockFindByLocationId,
    getByLocationId: mockGetByLocationId,
    update: mockUpdate,
    updateSnapshotStatus: mockUpdateSnapshotStatus,
  },
}));

jest.mock('../../src/clients/supabase.client', () => ({
  getSupabase: () => ({ from: jest.fn().mockReturnValue({ select: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ single: jest.fn() }) }) }) }),
}));

import { merchantService } from '../../src/services/merchant.service';

beforeEach(() => {
  jest.clearAllMocks();
  mockGetByLocationId.mockResolvedValue({
    location_id: 'loc_1',
    config: {},
    snapshot_attempts: 0,
    trigger_ids: {},
  });
  mockUpdate.mockResolvedValue({ location_id: 'loc_1', config: {} });
  mockUpdateSnapshotStatus.mockResolvedValue(undefined);
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
    // Existing fields — 3 of 5 SS fields exist
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

    // 2 missing SS fields + 45 offer fields = 47
    const createCalls = mockPost.mock.calls.filter(c => c[0] === '/custom-fields/');
    expect(createCalls.length).toBe(47);
    // Verify v2 body format includes objectKey
    expect(createCalls[0][1]).toMatchObject({ objectKey: 'contact', showInForms: false });
  });

  test('skips all if every field exists', async () => {
    const allKeys = [
      'contact.ss_enrollment_status', 'contact.ss_evidence_score',
      'contact.ss_last_evidence_date', 'contact.ss_chargeback_status',
      'contact.ss_defense_status',
      'contact.offer_business_name', 'contact.offer_name', 'contact.offer_price',
      'contact.offer_payment_type', 'contact.offer_installment_amount',
      'contact.offer_installment_frequency', 'contact.offer_num_payments',
      ...Array.from({ length: 11 }, (_, i) => [
        `contact.offer_clause_slot_${i + 1}_title`,
        `contact.offer_clause_slot_${i + 1}_text`,
      ]).flat(),
      ...Array.from({ length: 8 }, (_, i) => [
        `contact.offer_milestone_${i + 1}_name`,
        `contact.offer_milestone_${i + 1}_description`,
      ]).flat(),
    ];

    mockGet.mockResolvedValueOnce({
      data: { customFields: allKeys.map(k => ({ fieldKey: k })) },
    });

    const api = { post: mockPost, get: mockGet, put: mockPut } as any;
    await merchantService.createCustomFields(api, 'loc_1');

    const createCalls = mockPost.mock.calls.filter(c => c[0] === '/custom-fields/');
    expect(createCalls.length).toBe(0);
  });
});

describe('Custom Values Creation', () => {
  test('creates 3 custom values via v2 endpoint (locationId in path)', async () => {
    mockGet.mockResolvedValueOnce({ data: { customValues: [] } });
    mockPost.mockResolvedValue({ data: { id: 'cv_new' } });

    const api = { post: mockPost, get: mockGet, put: mockPut } as any;
    await merchantService.createCustomValues(api, 'loc_1');

    // Verify locationId in path, not body
    const createCalls = mockPost.mock.calls.filter(c => c[0] === '/locations/loc_1/customValues');
    expect(createCalls.length).toBe(3);
    expect(createCalls[0][1].name).toBe('SS--Business-Name');
    expect(createCalls[0][1]).not.toHaveProperty('locationId');
  });

  test('skips existing custom values', async () => {
    mockGet.mockResolvedValueOnce({
      data: {
        customValues: [
          { name: 'SS--Business-Name', id: 'cv_1' },
          { name: 'SS--Support-Email', id: 'cv_2' },
          { name: 'SS--TC-URL', id: 'cv_3' },
        ],
      },
    });

    const api = { post: mockPost, get: mockGet, put: mockPut } as any;
    await merchantService.createCustomValues(api, 'loc_1');

    const createCalls = mockPost.mock.calls.filter(c => c[0] === '/locations/loc_1/customValues');
    expect(createCalls.length).toBe(0);
  });
});

describe('Full Provisioning', () => {
  test('provisionMerchant orchestrates all steps and marks installed', async () => {
    // Pipeline list — found
    mockGet.mockResolvedValueOnce({ data: { pipelines: [{ id: 'pipe_1', name: 'Client Milestones' }] } });
    // Custom fields — none exist
    mockGet.mockResolvedValueOnce({ data: { customFields: [] } });
    // Custom values — none exist
    mockGet.mockResolvedValueOnce({ data: { customValues: [] } });

    // All POST calls succeed
    mockPost.mockResolvedValue({ data: { id: 'new_id' } });

    await merchantService.provisionMerchant('loc_1');

    expect(mockUpdateSnapshotStatus).toHaveBeenCalledWith('loc_1', 'installing');
    expect(mockUpdateSnapshotStatus).toHaveBeenCalledWith('loc_1', 'installed');

    // Should have stored pipeline ID in config
    expect(mockUpdate).toHaveBeenCalledWith('loc_1', expect.objectContaining({
      config: expect.objectContaining({ pipelineId: 'pipe_1' }),
    }));
  });

  test('provisionMerchant marks failed on error and schedules retry', async () => {
    jest.useFakeTimers();

    // All GETs fail
    mockGet.mockRejectedValue(new Error('GHL API down'));
    // All POSTs fail
    mockPost.mockRejectedValue(new Error('GHL API down'));

    await merchantService.provisionMerchant('loc_1');

    expect(mockUpdateSnapshotStatus).toHaveBeenCalledWith('loc_1', 'installing');
    expect(mockUpdateSnapshotStatus).toHaveBeenCalledWith('loc_1', 'failed', expect.any(String));

    jest.clearAllTimers();
    jest.useRealTimers();
  });
});
