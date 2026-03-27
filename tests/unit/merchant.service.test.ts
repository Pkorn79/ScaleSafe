/**
 * Merchant provisioning service tests.
 * Tests pipeline creation, custom field creation, custom value creation,
 * custom trigger registration, and the full provisioning orchestrator.
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
const mockUpdateTriggerIds = jest.fn();

jest.mock('../../src/repositories/merchant.repository', () => ({
  merchantRepository: {
    findByLocationId: mockFindByLocationId,
    getByLocationId: mockGetByLocationId,
    update: mockUpdate,
    updateSnapshotStatus: mockUpdateSnapshotStatus,
    updateTriggerIds: mockUpdateTriggerIds,
  },
}));

jest.mock('../../src/clients/supabase.client', () => ({
  getSupabase: () => ({ from: jest.fn().mockReturnValue({ select: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ single: jest.fn() }) }) }) }),
}));

import { merchantService } from '../../src/services/merchant.service';

beforeEach(() => {
  jest.clearAllMocks();
  // Default merchant record
  mockGetByLocationId.mockResolvedValue({
    location_id: 'loc_1',
    config: {},
    snapshot_attempts: 0,
    trigger_ids: {},
  });
  mockUpdate.mockResolvedValue({ location_id: 'loc_1', config: {} });
  mockUpdateSnapshotStatus.mockResolvedValue(undefined);
  mockUpdateTriggerIds.mockResolvedValue(undefined);
});

describe('Pipeline Creation', () => {
  test('creates pipeline with 8 stages when none exists', async () => {
    // No existing pipelines
    mockGet.mockResolvedValueOnce({ data: { pipelines: [] } });
    // Pipeline creation response
    mockPost.mockResolvedValueOnce({ data: { id: 'pipe_new' } });

    const api = { post: mockPost, get: mockGet, put: mockPut } as any;
    const pipelineId = await merchantService.createPipeline(api, 'loc_1');

    expect(pipelineId).toBe('pipe_new');
    expect(mockPost).toHaveBeenCalledWith('/opportunities/pipelines', expect.objectContaining({
      name: 'Client Milestones',
      locationId: 'loc_1',
      stages: expect.arrayContaining([
        expect.objectContaining({ name: 'Enrolled', position: 0 }),
        expect.objectContaining({ name: 'Completed', position: 7 }),
      ]),
    }));
    // 8 stages
    const call = mockPost.mock.calls[0];
    expect(call[1].stages).toHaveLength(8);
  });

  test('reuses existing pipeline if Client Milestones already exists', async () => {
    mockGet.mockResolvedValueOnce({
      data: { pipelines: [{ id: 'pipe_existing', name: 'Client Milestones' }] },
    });

    const api = { post: mockPost, get: mockGet, put: mockPut } as any;
    const pipelineId = await merchantService.createPipeline(api, 'loc_1');

    expect(pipelineId).toBe('pipe_existing');
    // Should NOT have called post to create a new pipeline
    expect(mockPost).not.toHaveBeenCalled();
  });
});

describe('Custom Fields Creation', () => {
  test('creates only missing fields', async () => {
    // Existing fields — simulate 3 of the 5 SS fields already exist
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

    // Should have created fields for the 2 missing SS fields + all 45 offer fields = 47
    // (5 SS total - 3 existing = 2) + (7 base + 22 clause + 16 milestone = 45) = 47
    const createCalls = mockPost.mock.calls.filter(c => c[0] === '/locations/custom-fields');
    expect(createCalls.length).toBe(47);
  });

  test('skips all if every field exists', async () => {
    // All SS fields + all offer fields exist
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

    // No create calls
    const createCalls = mockPost.mock.calls.filter(c => c[0] === '/locations/custom-fields');
    expect(createCalls.length).toBe(0);
  });
});

describe('Custom Values Creation', () => {
  test('creates 3 custom values when none exist', async () => {
    mockGet.mockResolvedValueOnce({ data: { customValues: [] } });
    mockPost.mockResolvedValue({ data: { id: 'cv_new' } });

    const api = { post: mockPost, get: mockGet, put: mockPut } as any;
    await merchantService.createCustomValues(api, 'loc_1');

    const createCalls = mockPost.mock.calls.filter(c => c[0] === '/locations/customValues');
    expect(createCalls.length).toBe(3);
    expect(createCalls[0][1].name).toBe('SS--Business-Name');
    expect(createCalls[1][1].name).toBe('SS--Support-Email');
    expect(createCalls[2][1].name).toBe('SS--TC-URL');
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

    const createCalls = mockPost.mock.calls.filter(c => c[0] === '/locations/customValues');
    expect(createCalls.length).toBe(0);
  });
});

describe('Custom Triggers Registration', () => {
  test('registers all 5 triggers and returns IDs', async () => {
    let callCount = 0;
    mockPost.mockImplementation(async () => {
      callCount++;
      return { data: { id: `trigger_${callCount}` } };
    });

    const api = { post: mockPost, get: mockGet, put: mockPut } as any;
    const triggerIds = await merchantService.registerCustomTriggers(api, 'loc_1');

    expect(Object.keys(triggerIds)).toHaveLength(5);
    expect(triggerIds.CHARGEBACK_DETECTED).toBeDefined();
    expect(triggerIds.DEFENSE_READY).toBeDefined();
    expect(triggerIds.EVIDENCE_MILESTONE).toBeDefined();
    expect(triggerIds.CLIENT_AT_RISK).toBeDefined();
    expect(triggerIds.PAYMENT_FAILED).toBeDefined();

    // Verify trigger names in the POST calls
    const triggerCalls = mockPost.mock.calls.filter(c => c[0] === '/custom-workflow-triggers');
    const names = triggerCalls.map(c => c[1].name);
    expect(names).toContain('Chargeback Detected');
    expect(names).toContain('Defense Ready');
    expect(names).toContain('Evidence Milestone');
    expect(names).toContain('Client At Risk');
    expect(names).toContain('Payment Failed');
  });

  test('handles existing triggers gracefully (422)', async () => {
    // First trigger succeeds, second gets 422 (already exists)
    mockPost
      .mockResolvedValueOnce({ data: { id: 'trigger_1' } })
      .mockRejectedValueOnce({ status: 422, message: 'Already exists' })
      .mockResolvedValueOnce({ data: { id: 'trigger_3' } })
      .mockResolvedValueOnce({ data: { id: 'trigger_4' } })
      .mockResolvedValueOnce({ data: { id: 'trigger_5' } });

    // When looking up existing triggers after 422
    mockGet.mockResolvedValueOnce({
      data: { triggers: [{ id: 'trigger_existing', name: 'Defense Ready' }] },
    });

    const api = { post: mockPost, get: mockGet, put: mockPut } as any;
    const triggerIds = await merchantService.registerCustomTriggers(api, 'loc_1');

    expect(triggerIds.CHARGEBACK_DETECTED).toBe('trigger_1');
    expect(triggerIds.DEFENSE_READY).toBe('trigger_existing');
  });
});

describe('Full Provisioning', () => {
  test('provisionMerchant orchestrates all steps and marks installed', async () => {
    // Pipeline list — none exist
    mockGet.mockResolvedValueOnce({ data: { pipelines: [] } });
    // Custom fields — none exist
    mockGet.mockResolvedValueOnce({ data: { customFields: [] } });
    // Custom values — none exist
    mockGet.mockResolvedValueOnce({ data: { customValues: [] } });

    // All POST calls succeed
    mockPost.mockResolvedValue({ data: { id: 'new_id' } });

    await merchantService.provisionMerchant('loc_1');

    // Should have set status to 'installing' then 'installed'
    expect(mockUpdateSnapshotStatus).toHaveBeenCalledWith('loc_1', 'installing');
    expect(mockUpdateSnapshotStatus).toHaveBeenCalledWith('loc_1', 'installed');

    // Should have stored trigger IDs
    expect(mockUpdateTriggerIds).toHaveBeenCalledWith('loc_1', expect.objectContaining({
      CHARGEBACK_DETECTED: expect.any(String),
      PAYMENT_FAILED: expect.any(String),
    }));

    // Should have stored pipeline ID in config
    expect(mockUpdate).toHaveBeenCalledWith('loc_1', expect.objectContaining({
      config: expect.objectContaining({ pipelineId: expect.any(String) }),
    }));
  });

  test('provisionMerchant marks failed on error', async () => {
    jest.useFakeTimers();

    // Make pipeline creation fail
    mockGet.mockRejectedValueOnce(new Error('GHL API down'));
    // Pipeline post also fails
    mockPost.mockRejectedValueOnce(new Error('GHL API down'));

    // Custom fields — succeeds
    mockGet.mockResolvedValueOnce({ data: { customFields: [] } });
    // Custom values — succeeds
    mockGet.mockResolvedValueOnce({ data: { customValues: [] } });

    await merchantService.provisionMerchant('loc_1');

    expect(mockUpdateSnapshotStatus).toHaveBeenCalledWith('loc_1', 'installing');
    expect(mockUpdateSnapshotStatus).toHaveBeenCalledWith('loc_1', 'failed', expect.any(String));

    // Clear the retry timer to prevent Jest from hanging
    jest.clearAllTimers();
    jest.useRealTimers();
  });
});
