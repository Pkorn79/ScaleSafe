const tableQueues: Record<string, any[]> = {};

function chain(result: { data: any; error: any }) {
  const builder: any = {};
  for (const method of ['select', 'eq', 'in', 'order', 'limit']) builder[method] = jest.fn(() => builder);
  builder.single = jest.fn(async () => result);
  builder.maybeSingle = jest.fn(async () => result);
  builder.then = (resolve: any, reject: any) => Promise.resolve(result).then(resolve, reject);
  return builder;
}

const mockFrom = jest.fn((table: string) => {
  const next = tableQueues[table]?.shift();
  if (!next) throw new Error(`Unexpected query for ${table}`);
  return next;
});

jest.mock('../../src/clients/supabase.client', () => ({
  getSupabase: () => ({ from: mockFrom }),
}));

jest.mock('../../src/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import { defenseSubmissionService } from '../../src/services/defense-submission.service';

function queuedInsert(result: { data: any; error: any }) {
  return { insert: jest.fn(() => chain(result)) };
}

function queuedSelect(result: { data: any; error: any }) {
  return { select: jest.fn(() => chain(result)) };
}

function queuedUpdate(result: { data: any; error: any }) {
  return { update: jest.fn(() => chain(result)) };
}

beforeEach(() => {
  jest.clearAllMocks();
  for (const key of Object.keys(tableQueues)) delete tableQueues[key];
});

describe('defenseSubmissionService', () => {
  test('atomically creates the first submission claim', async () => {
    const claim = {
      id: 'claim_1', location_id: 'loc_1', defense_packet_id: 'def_1',
      request_fingerprint: 'hash', status: 'processing', provider_called: false,
    };
    tableQueues.defense_submission_claims = [queuedInsert({ data: claim, error: null })];

    const result = await defenseSubmissionService.begin({
      locationId: 'loc_1', defensePacketId: 'def_1', request: { version: 1 },
    });

    expect(result.action).toBe('execute');
    expect(result.claim.id).toBe('claim_1');
  });

  test('a duplicate in-flight claim is blocked instead of executing twice', async () => {
    const request = { version: 1 };
    const existing = {
      id: 'claim_1', location_id: 'loc_1', defense_packet_id: 'def_1',
      request_fingerprint: defenseSubmissionService.fingerprint(request),
      status: 'unknown', provider_called: true,
    };
    tableQueues.defense_submission_claims = [
      queuedInsert({ data: null, error: { code: '23505' } }),
      queuedSelect({ data: existing, error: null }),
    ];

    const result = await defenseSubmissionService.begin({
      locationId: 'loc_1', defensePacketId: 'def_1', request,
    });

    expect(result).toMatchObject({ action: 'blocked', claim: { id: 'claim_1', status: 'unknown' } });
  });

  test('reclaims a stale claim that never crossed the provider boundary', async () => {
    const request = { version: 2 };
    const existing = {
      id: 'claim_1', location_id: 'loc_1', defense_packet_id: 'def_1',
      request_fingerprint: defenseSubmissionService.fingerprint({ version: 1 }),
      status: 'processing', provider_called: false,
      claimed_at: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
    };
    const reclaimed = {
      ...existing,
      request_fingerprint: defenseSubmissionService.fingerprint(request),
      claimed_at: new Date().toISOString(),
    };
    tableQueues.defense_submission_claims = [
      queuedInsert({ data: null, error: { code: '23505' } }),
      queuedSelect({ data: existing, error: null }),
      queuedUpdate({ data: reclaimed, error: null }),
    ];

    const result = await defenseSubmissionService.begin({
      locationId: 'loc_1', defensePacketId: 'def_1', request,
    });

    expect(result).toMatchObject({ action: 'execute', claim: { id: 'claim_1' } });
  });

  test('a pre-provider failure can retry a regenerated packet with a new fingerprint', async () => {
    const existing = {
      id: 'claim_1', location_id: 'loc_1', defense_packet_id: 'def_1',
      request_fingerprint: defenseSubmissionService.fingerprint({ version: 1 }),
      status: 'failed', provider_called: false,
    };
    const retried = {
      ...existing,
      request_fingerprint: defenseSubmissionService.fingerprint({ version: 2 }),
      status: 'processing',
    };
    tableQueues.defense_submission_claims = [
      queuedInsert({ data: null, error: { code: '23505' } }),
      queuedSelect({ data: existing, error: null }),
      queuedUpdate({ data: retried, error: null }),
    ];

    const result = await defenseSubmissionService.begin({
      locationId: 'loc_1', defensePacketId: 'def_1', request: { version: 2 },
    });

    expect(result).toMatchObject({ action: 'execute', claim: { status: 'processing' } });
  });

  test('finalizes only local records after provider acceptance', async () => {
    tableQueues.defense_submission_claims = [
      queuedSelect({ data: {
        id: 'claim_1', location_id: 'loc_1', defense_packet_id: 'def_1',
        status: 'provider_accepted', dispute_event_id: 'de_1',
      }, error: null }),
      queuedUpdate({ data: [{ id: 'claim_1' }], error: null }),
    ];
    tableQueues.defense_packets = [
      queuedSelect({ data: { id: 'def_1', dispute_event_id: 'de_1', lifecycle_status: 'pending_submission' }, error: null }),
      queuedUpdate({ data: [{ id: 'def_1' }], error: null }),
    ];
    tableQueues.defense_letter_versions = [
      queuedSelect({ data: { id: 'ver_2', version_number: 2, is_submitted_version: false }, error: null }),
      queuedUpdate({ data: [{ id: 'ver_2' }], error: null }),
    ];
    tableQueues.dispute_events = [
      queuedUpdate({ data: [{ id: 'de_1' }], error: null }),
    ];

    await defenseSubmissionService.finalizeAccepted('claim_1', 'loc_1');

    expect(mockFrom).toHaveBeenCalledWith('defense_letter_versions');
    expect(mockFrom).toHaveBeenCalledWith('defense_packets');
    expect(mockFrom).toHaveBeenCalledWith('dispute_events');
  });

  test('finishes a partially completed local submission without repeating completed writes', async () => {
    tableQueues.defense_submission_claims = [
      queuedSelect({ data: {
        id: 'claim_1', location_id: 'loc_1', defense_packet_id: 'def_1',
        status: 'provider_accepted', dispute_event_id: 'de_1',
      }, error: null }),
      queuedUpdate({ data: [{ id: 'claim_1' }], error: null }),
    ];
    tableQueues.defense_packets = [
      queuedSelect({ data: { id: 'def_1', dispute_event_id: 'de_1', lifecycle_status: 'submitted' }, error: null }),
    ];
    tableQueues.defense_letter_versions = [
      queuedSelect({ data: { id: 'ver_2', version_number: 2, is_submitted_version: true }, error: null }),
    ];
    tableQueues.dispute_events = [
      queuedUpdate({ data: [{ id: 'de_1' }], error: null }),
    ];

    await defenseSubmissionService.finalizeAccepted('claim_1', 'loc_1');

    expect(tableQueues.defense_packets).toHaveLength(0);
    expect(tableQueues.defense_letter_versions).toHaveLength(0);
    expect(mockFrom).toHaveBeenCalledWith('dispute_events');
  });
});
