const mockSupabaseFrom = jest.fn();

jest.mock('../../src/clients/supabase.client', () => ({
  getSupabase: () => ({ from: (...args: any[]) => mockSupabaseFrom(...args) }),
}));

import { submitPulseCheckin } from '../../src/controllers/payment-update.controller';
import { createPublicActionToken } from '../../src/utils/public-action-token';

function makeBuilder(response: { data?: any; error?: any }) {
  const builder: any = {
    payload: null as any,
    select: jest.fn(() => builder),
    eq: jest.fn(() => builder),
    in: jest.fn(() => builder),
    maybeSingle: jest.fn(async () => response),
    insert: jest.fn(async (payload: any) => {
      builder.payload = payload;
      return response;
    }),
    then: (resolve: any, reject: any) => Promise.resolve(response).then(resolve, reject),
  };
  return builder;
}

describe('submitPulseCheckin', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.PUBLIC_ACTION_TOKEN_SECRET = 'unit-test-public-action-secret';
  });

  afterEach(() => {
    delete process.env.PUBLIC_ACTION_TOKEN_SECRET;
  });

  it('stores a pulse as enrollment-scoped client engagement, not delivery proof', async () => {
    const token = createPublicActionToken({
      action: 'pulse_checkin',
      locationId: 'loc_1',
      contactId: 'contact_1',
      enrollmentId: 'enr_1',
    });
    const enrollmentBuilder = makeBuilder({
      data: {
        id: 'enr_1', offer_id: 'offer_1', first_name: 'Test', last_name: 'Client',
        email: 'client@example.com',
      },
      error: null,
    });
    const pulseBuilder = makeBuilder({ error: null });
    mockSupabaseFrom.mockImplementation((table: string) => {
      if (table === 'enrollments') return enrollmentBuilder;
      if (table === 'evidence_pulse_checkins') return pulseBuilder;
      throw new Error(`Unexpected Supabase table call: ${table}`);
    });

    const req: any = {
      query: { actionToken: token },
      body: {
        satisfaction: 4,
        goingWell: 'Implementation is moving forward',
        concerns: 'Please review the next step',
        followUpNeeded: true,
      },
      headers: { 'x-forwarded-for': '1.2.3.4' },
      socket: { remoteAddress: '5.6.7.8' },
    };
    const res: any = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };

    await submitPulseCheckin(req, res, jest.fn());

    expect(pulseBuilder.payload).toEqual(expect.objectContaining({
      location_id: 'loc_1',
      contact_id: 'contact_1',
      enrollment_id: 'enr_1',
      sentiment_score: 4,
      follow_up_needed: true,
      proof_role: 'client_engagement',
    }));
    expect(pulseBuilder.payload.proof_role).not.toBe('service_delivery');
    expect(res.json).toHaveBeenCalledWith({ success: true });
  });
});
