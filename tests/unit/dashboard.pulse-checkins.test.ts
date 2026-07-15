/**
 * Pulse merchant-alerting tests (launch gap: merchants had no in-app visibility
 * of submitted pulse check-ins).
 *
 * - A normal submission surfaces with NO attention flag.
 * - follow_up_needed=true (the client checked the concern box) is an obvious
 *   attention item, sorted first.
 * - Low satisfaction (<=2/5) also flags attention.
 * - Legacy rows without an enrollment link surface as unlinked (never guessed
 *   onto a program).
 */

const mockSupabaseFrom = jest.fn();

jest.mock('../../src/clients/supabase.client', () => ({
  getSupabase: () => ({ from: (...args: any[]) => mockSupabaseFrom(...args) }),
}));

import { dashboardController } from '../../src/controllers/dashboard.controller';

function makeBuilder(response: { data?: any; error?: any }) {
  const builder: any = {
    select: jest.fn(() => builder),
    order: jest.fn(() => builder),
    limit: jest.fn(() => builder),
    in: jest.fn(() => builder),
    eq: jest.fn(() => builder),
    then: (resolve: any, reject: any) => Promise.resolve(response).then(resolve, reject),
  };
  return builder;
}

function queueBuilders(builders: Record<string, any[]>) {
  mockSupabaseFrom.mockImplementation((table: string) => {
    const queue = builders[table] || [];
    const builder = queue.shift();
    if (!builder) throw new Error(`Unexpected Supabase table call: ${table}`);
    return builder;
  });
}

function mockResponse() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  };
}

function request(query: Record<string, string> = {}) {
  return { params: { locationId: 'loc_1' }, query } as any;
}

const normalCheckin = {
  id: 'pc_ok', contact_id: 'c_1', contact_name: 'Happy Client', enrollment_id: 'enr_1',
  sentiment_score: 5, feedback_text: 'Going well: everything great', follow_up_needed: false,
  follow_up_action: null, checkin_date: '2026-07-07', created_at: '2026-07-07T10:00:00Z',
  raw_payload: { offerId: 'offer_1' },
};

const attentionCheckin = {
  id: 'pc_flag', contact_id: 'c_2', contact_name: 'Worried Client', enrollment_id: 'enr_2',
  sentiment_score: 4, feedback_text: 'Concerns: please call me', follow_up_needed: true,
  follow_up_action: 'Merchant follow-up requested from pulse check-in',
  checkin_date: '2026-07-06', created_at: '2026-07-06T10:00:00Z',
  raw_payload: { offerId: 'offer_2' },
};

const lowScoreCheckin = {
  id: 'pc_low', contact_id: 'c_3', contact_name: 'Unhappy Client', enrollment_id: 'enr_1',
  sentiment_score: 2, feedback_text: null, follow_up_needed: false,
  follow_up_action: null, checkin_date: '2026-07-05', created_at: '2026-07-05T10:00:00Z',
  raw_payload: {},
};

const unlinkedCheckin = {
  id: 'pc_unlinked', contact_id: 'c_4', contact_name: 'Legacy Client', enrollment_id: null,
  sentiment_score: 4, feedback_text: 'from an old GHL form', follow_up_needed: false,
  follow_up_action: null, checkin_date: '2026-07-04', created_at: '2026-07-04T10:00:00Z',
  raw_payload: null,
};

const enrollmentRows = [
  { id: 'enr_1', offer_id: 'offer_1' },
  { id: 'enr_2', offer_id: 'offer_2' },
];
const offerRows = [
  { id: 'offer_1', offer_name: 'Coaching Program A', internal_name: 'Ops A' },
  { id: 'offer_2', offer_name: 'Mastermind B', internal_name: 'Ops B' },
];

beforeEach(() => {
  jest.clearAllMocks();
});

describe('dashboardController.pulseCheckins', () => {
  test('normal submission surfaces with no attention flag and a resolved program name', async () => {
    queueBuilders({
      evidence_pulse_checkins: [makeBuilder({ data: [normalCheckin], error: null })],
      enrollments: [makeBuilder({ data: [enrollmentRows[0]], error: null })],
      offers_mirror: [makeBuilder({ data: [offerRows[0]], error: null })],
    });
    const res = mockResponse();

    await dashboardController.pulseCheckins(request(), res as any, jest.fn());

    const body = res.json.mock.calls[0][0];
    expect(body.attentionCount).toBe(0);
    expect(body.checkins).toHaveLength(1);
    expect(body.checkins[0]).toMatchObject({
      id: 'pc_ok',
      contactName: 'Happy Client',
      offerName: 'Coaching Program A',
      offerInternalName: 'Ops A',
      enrollmentId: 'enr_1',
      linked: true,
      satisfaction: 5,
      needsAttention: false,
      attentionReason: null,
    });
  });

  test('follow-up requested creates an obvious attention item, sorted first', async () => {
    queueBuilders({
      evidence_pulse_checkins: [makeBuilder({ data: [normalCheckin, attentionCheckin], error: null })],
      enrollments: [makeBuilder({ data: enrollmentRows, error: null })],
      offers_mirror: [makeBuilder({ data: offerRows, error: null })],
    });
    const res = mockResponse();

    await dashboardController.pulseCheckins(request(), res as any, jest.fn());

    const body = res.json.mock.calls[0][0];
    expect(body.attentionCount).toBe(1);
    // Attention item sorts ahead of the newer normal one
    expect(body.checkins[0]).toMatchObject({
      id: 'pc_flag',
      needsAttention: true,
      followUpNeeded: true,
      attentionReason: 'Client requested follow-up',
      offerName: 'Mastermind B',
      offerInternalName: 'Ops B',
      enrollmentId: 'enr_2',
    });
    expect(body.checkins[1].id).toBe('pc_ok');
  });

  test('low satisfaction (<=2) flags attention even without the follow-up box', async () => {
    queueBuilders({
      evidence_pulse_checkins: [makeBuilder({ data: [lowScoreCheckin], error: null })],
      enrollments: [makeBuilder({ data: [enrollmentRows[0]], error: null })],
      offers_mirror: [makeBuilder({ data: [offerRows[0]], error: null })],
    });
    const res = mockResponse();

    await dashboardController.pulseCheckins(request(), res as any, jest.fn());

    const body = res.json.mock.calls[0][0];
    expect(body.checkins[0]).toMatchObject({
      needsAttention: true,
      followUpNeeded: false,
      attentionReason: 'Low satisfaction (2/5)',
    });
  });

  test('unlinked legacy rows surface as not-linked instead of guessing a program', async () => {
    queueBuilders({
      evidence_pulse_checkins: [makeBuilder({ data: [unlinkedCheckin], error: null })],
      // No enrollment ids to resolve → enrollments/offers never queried
    });
    const res = mockResponse();

    await dashboardController.pulseCheckins(request(), res as any, jest.fn());

    const body = res.json.mock.calls[0][0];
    expect(body.checkins[0]).toMatchObject({
      id: 'pc_unlinked',
      linked: false,
      enrollmentId: null,
      offerName: null,
    });
  });

  test('query failure propagates to the error handler (not silently swallowed)', async () => {
    queueBuilders({
      evidence_pulse_checkins: [makeBuilder({ data: null, error: { message: 'boom' } })],
    });
    const res = mockResponse();
    const next = jest.fn();

    await dashboardController.pulseCheckins(request(), res as any, next);

    expect(next).toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
  });
});
