const from = jest.fn();
jest.mock('../../src/clients/supabase.client', () => ({ getSupabase: () => ({ from }) }));
import { zoomIntegrationRepository } from '../../src/repositories/zoom-integration.repository';

let query: any;
beforeEach(() => {
  query = {};
  for (const method of ['select', 'eq', 'lte', 'order', 'limit', 'update', 'upsert']) {
    query[method] = jest.fn(() => query);
  }
  query.maybeSingle = jest.fn().mockResolvedValue({ data: null, error: null });
  query.then = (resolve: any) => Promise.resolve({ error: null }).then(resolve);
  from.mockReturnValue(query);
});

test('completion is scoped and compare-and-set, allowing retry after another worker wins', async () => {
  await expect(zoomIntegrationRepository.completeAttendance('conn', 'row', { status: 'completed' })).resolves.toBeNull();
  expect(query.eq.mock.calls).toEqual([['id', 'row'], ['connection_id', 'conn'], ['status', 'joined']]);
  expect(query.maybeSingle).toHaveBeenCalled();
});

test('open interval lookup cannot consume a later rejoin', async () => {
  await zoomIntegrationRepository.findOpenAttendance('conn', 'meeting', 'participant', '2026-10-01T14:30:00Z');
  expect(query.eq.mock.calls).toEqual([
    ['connection_id', 'conn'], ['meeting_uuid', 'meeting'], ['participant_instance_id', 'participant'], ['status', 'joined'],
  ]);
  expect(query.lte).toHaveBeenCalledWith('joined_at', '2026-10-01T14:30:00Z');
  expect(query.order).toHaveBeenCalledWith('joined_at', { ascending: false });
});

test.each(['joined_at', 'left_at'] as const)('recovery lookup scopes %s to connection, meeting instance, and participant', async (field) => {
  await zoomIntegrationRepository.findAttendanceAt('conn', 'meeting', 'participant', field, '2026-10-01T14:30:00Z');
  expect(query.eq.mock.calls).toEqual([
    ['connection_id', 'conn'], ['meeting_uuid', 'meeting'], ['participant_instance_id', 'participant'], [field, '2026-10-01T14:30:00Z'],
  ]);
});

test('publishing cannot update another connection or a quarantined row', async () => {
  await zoomIntegrationRepository.linkEvidenceEvent('conn', 'row', 'event');
  expect(query.update).toHaveBeenCalledWith({ evidence_event_id: 'event', status: 'published' });
  expect(query.eq.mock.calls).toEqual([['id', 'row'], ['connection_id', 'conn'], ['status', 'completed']]);
});

test('joins preserve the database deduplication constraint', async () => {
  const input = { connection_id: 'conn', join_source_event_id: 'stable-id', status: 'joined' };
  await zoomIntegrationRepository.createAttendance(input);
  expect(query.upsert).toHaveBeenCalledWith(input, { onConflict: 'connection_id,join_source_event_id', ignoreDuplicates: true });
});

test('lookup errors are not converted into missing joins', async () => {
  query.maybeSingle.mockResolvedValue({ error: new Error('database offline') });
  await expect(zoomIntegrationRepository.findAttendanceAt('conn', 'meeting', 'participant', 'left_at', '2026-10-01T14:30:00Z'))
    .rejects.toThrow('database offline');
});
