const mockEnrollmentEq = jest.fn();
const mockEnrollmentUpdate = jest.fn();
const mockFrom = jest.fn();

jest.mock('../../src/clients/supabase.client', () => ({
  getSupabase: () => ({ from: mockFrom }),
}));

jest.mock('../../src/services/trigger.service', () => ({
  triggerService: { fireTrigger: jest.fn().mockResolvedValue({ sent: 1, failed: 0 }) },
}));

jest.mock('../../src/services/evidence.service', () => ({
  evidenceService: { logEvidence: jest.fn().mockResolvedValue(undefined) },
}));

jest.mock('../../src/clients/ghl.client', () => ({
  ghlApi: jest.fn().mockResolvedValue({ put: jest.fn().mockResolvedValue({ data: {} }) }),
}));

jest.mock('../../src/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import { runPifCompletionCheck } from '../../src/jobs/pif-completion-check';

describe('PIF completion tenant boundary', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    const enrollmentUpdateQuery: any = {};
    mockEnrollmentEq.mockImplementation(() => enrollmentUpdateQuery);
    enrollmentUpdateQuery.eq = mockEnrollmentEq;
    enrollmentUpdateQuery.then = (resolve: (value: unknown) => void) => resolve({ error: null });
    mockEnrollmentUpdate.mockReturnValue(enrollmentUpdateQuery);

    mockFrom.mockImplementation((table: string) => {
      if (table === 'enrollments') {
        const initialQuery: any = {};
        initialQuery.in = jest.fn(() => initialQuery);
        initialQuery.eq = jest.fn(() => initialQuery);
        initialQuery.not = jest.fn()
          .mockReturnValueOnce(initialQuery)
          .mockResolvedValueOnce({
            data: [{
              id: 'enrollment_1',
              location_id: 'location_1',
              merchant_id: 'merchant_1',
              contact_id: 'contact_1',
              offer_id: 'offer_1',
              enrolled_at: '2025-01-01T00:00:00.000Z',
              email: 'client@example.com',
              next_billing_date: null,
            }],
            error: null,
          });
        return {
          select: jest.fn(() => initialQuery),
          update: mockEnrollmentUpdate,
        };
      }

      if (table === 'offers_mirror') {
        return {
          select: jest.fn(() => ({
            in: jest.fn().mockResolvedValue({
              data: [{
                id: 'offer_1',
                offer_name: 'Completed Program',
                program_duration_value: 1,
                program_duration_unit: 'weeks',
                auto_complete_on_duration_end: true,
              }],
              error: null,
            }),
          })),
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    });
  });

  it('requires both enrollment ID and location ID when completing a program', async () => {
    await runPifCompletionCheck();

    expect(mockEnrollmentUpdate).toHaveBeenCalledWith(expect.objectContaining({ status: 'completed' }));
    expect(mockEnrollmentEq).toHaveBeenNthCalledWith(1, 'id', 'enrollment_1');
    expect(mockEnrollmentEq).toHaveBeenNthCalledWith(2, 'location_id', 'location_1');
  });
});
