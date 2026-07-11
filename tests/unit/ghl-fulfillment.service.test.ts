const mockGetMerchant = jest.fn();
const mockListActivityEvents = jest.fn();
const mockListCourseEvidence = jest.fn();

jest.mock('../../src/repositories/merchant.repository', () => ({
  merchantRepository: {
    getByLocationId: (...args: any[]) => mockGetMerchant(...args),
  },
}));

jest.mock('../../src/repositories/ghl-fulfillment.repository', () => ({
  ghlFulfillmentRepository: {
    listActivityEvents: (...args: any[]) => mockListActivityEvents(...args),
    listCourseEvidence: (...args: any[]) => mockListCourseEvidence(...args),
  },
}));

import { ghlFulfillmentService } from '../../src/services/ghl-fulfillment.service';

beforeEach(() => {
  jest.clearAllMocks();
  mockGetMerchant.mockResolvedValue({
    ghl_scopes: 'calendars/events.readonly conversations/message.readonly',
    module_course: true,
    webhook_secret: 'configured',
  });
  mockListActivityEvents.mockResolvedValue([]);
  mockListCourseEvidence.mockResolvedValue([]);
});

describe('ghlFulfillmentService', () => {
  test('reports authorized calendar intake before the first event is observed', async () => {
    const result = await ghlFulfillmentService.getHealth('loc_1');

    expect(mockGetMerchant).toHaveBeenCalledWith('loc_1');
    expect(mockListActivityEvents).toHaveBeenCalledWith('loc_1', 150);
    expect(result.healthStatus).toBe('ready');
    expect(result.capabilities.find((item) => item.key === 'appointments')).toMatchObject({
      status: 'ready',
      eventCount: 0,
    });
    expect(result.capabilities.find((item) => item.key === 'course_progress')?.status).toBe('testing');
  });

  test('shows observed appointment and course evidence as active and enrollment matched', async () => {
    mockListActivityEvents.mockResolvedValue([{
      id: 'activity_1',
      source_object: 'appointment',
      event_type: 'AppointmentCreate',
      status: 'matched',
      enrollment_id: 'enr_1',
      offer_id: 'offer_1',
      occurred_at: '2026-07-11T15:00:00.000Z',
      created_at: '2026-07-11T14:55:00.000Z',
      normalized: { title: 'Implementation Call' },
    }]);
    mockListCourseEvidence.mockResolvedValue([{
      id: 'course_1',
      table: 'evidence_course_completion',
      created_at: '2026-07-11T16:00:00.000Z',
      contact_id: 'contact_1',
      enrollment_id: 'enr_1',
      offer_id: 'offer_1',
      source: 'ghl_course',
      payload: { course_name: 'ScaleSafe Setup' },
    }]);

    const result = await ghlFulfillmentService.getHealth('loc_1');

    expect(result.matchedCount).toBe(2);
    expect(result.unresolvedCount).toBe(0);
    expect(result.capabilities.find((item) => item.key === 'appointments')?.status).toBe('active');
    expect(result.capabilities.find((item) => item.key === 'course_progress')?.status).toBe('active');
    expect(result.recentEvents[0]).toMatchObject({ source: 'course', enrollmentId: 'enr_1' });
  });

  test('warns when calendar scope is missing and surfaces unresolved activity', async () => {
    mockGetMerchant.mockResolvedValue({ ghl_scopes: '', module_course: false, webhook_secret: null });
    mockListActivityEvents.mockResolvedValue([{
      id: 'activity_2',
      source_object: 'appointment',
      event_type: 'AppointmentUpdate',
      status: 'client_level',
      enrollment_id: null,
      occurred_at: '2026-07-11T15:00:00.000Z',
      created_at: '2026-07-11T15:01:00.000Z',
      normalized: {},
    }]);

    const result = await ghlFulfillmentService.getHealth('loc_2');

    expect(result.healthStatus).toBe('warning');
    expect(result.needsAttention).toBe(true);
    expect(result.unresolvedCount).toBe(1);
    expect(result.capabilities.find((item) => item.key === 'appointments')?.status).toBe('active');
  });

  test('does not leak another tenant into diagnostics queries', async () => {
    await ghlFulfillmentService.getHealth('tenant_exact');

    expect(mockListActivityEvents.mock.calls[0][0]).toBe('tenant_exact');
    expect(mockListCourseEvidence.mock.calls[0][0]).toBe('tenant_exact');
  });
});
