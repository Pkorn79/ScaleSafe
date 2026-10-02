import crypto from 'crypto';

const getAuthorizationByAccount = jest.fn();
const createAttendance = jest.fn();
const findOpenAttendance = jest.fn();
const findAttendanceAt = jest.fn();
const completeAttendance = jest.fn();
const linkEvidenceEvent = jest.fn();
const ingestCanonical = jest.fn();

jest.mock('../../src/repositories/zoom-integration.repository', () => ({
  zoomIntegrationRepository: {
    getAuthorizationByAccount: (...args: any[]) => getAuthorizationByAccount(...args),
    createAttendance: (...args: any[]) => createAttendance(...args),
    findOpenAttendance: (...args: any[]) => findOpenAttendance(...args),
    findAttendanceAt: (...args: any[]) => findAttendanceAt(...args),
    completeAttendance: (...args: any[]) => completeAttendance(...args),
    linkEvidenceEvent: (...args: any[]) => linkEvidenceEvent(...args),
  },
}));

jest.mock('../../src/repositories/evidence-connector.repository', () => ({
  evidenceConnectorRepository: {},
}));
jest.mock('../../src/repositories/merchant.repository', () => ({ merchantRepository: {} }));
jest.mock('../../src/services/evidence-connection.service', () => ({ evidenceConnectionService: {} }));
jest.mock('../../src/services/evidence-connector.service', () => ({
  evidenceConnectorService: { ingestCanonical: (...args: any[]) => ingestCanonical(...args) },
}));
jest.mock('../../src/integrations/zoom.adapter', () => ({ zoomAdapter: {} }));

import { config } from '../../src/config';
import { zoomIntegrationService } from '../../src/services/zoom-integration.service';

const connection = {
  id: 'connection-1',
  merchant_id: 'merchant-1',
  location_id: 'location-1',
  source_label: 'Zoom',
  status: 'active',
  setup_status: 'active',
};

function signedBody(payload: Record<string, unknown>, timestamp = String(Math.floor(Date.now() / 1000))) {
  const raw = Buffer.from(JSON.stringify(payload));
  const signature = `v0=${crypto.createHmac('sha256', config.zoom.webhookSecretToken)
    .update(`v0:${timestamp}:${raw.toString('utf8')}`).digest('hex')}`;
  return { raw, timestamp, signature };
}

describe('Zoom evidence integration', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    getAuthorizationByAccount.mockResolvedValue({ id: 'auth-1', connection });
    findAttendanceAt.mockResolvedValue(null);
    linkEvidenceEvent.mockResolvedValue(undefined);
  });

  it('verifies the exact Zoom webhook body and rejects stale timestamps', () => {
    const current = signedBody({ event: 'meeting.participant_left' });
    expect(zoomIntegrationService.verifyWebhook(current.raw, current.timestamp, current.signature)).toBe(true);

    const stale = signedBody({ event: 'meeting.participant_left' }, String(Math.floor((Date.now() - 10 * 60_000) / 1000)));
    expect(zoomIntegrationService.verifyWebhook(stale.raw, stale.timestamp, stale.signature)).toBe(false);
    expect(zoomIntegrationService.verifyWebhook(current.raw, current.timestamp, 'v0=wrong')).toBe(false);
  });

  it('responds to Zoom endpoint validation with the documented HMAC', () => {
    const result = zoomIntegrationService.endpointValidation('plain-token');
    expect(result).toEqual({
      plainToken: 'plain-token',
      encryptedToken: crypto.createHmac('sha256', config.zoom.webhookSecretToken).update('plain-token').digest('hex'),
    });
  });

  it('records one joined session without publishing premature evidence', async () => {
    createAttendance.mockResolvedValue({ id: 'attendance-1' });
    const payload = {
      event: 'meeting.participant_joined', event_ts: Date.now(),
      payload: { account_id: 'zoom-account', object: {
        id: 12345, uuid: 'meeting-instance', topic: 'Implementation Call',
        participant: { participant_uuid: 'participant-instance', registrant_id: 'registrant-1', email: 'client@example.com', join_time: '2026-07-11T14:00:00Z' },
      } },
    };
    const raw = Buffer.from(JSON.stringify(payload));
    await expect(zoomIntegrationService.handleWebhook(payload, raw)).resolves.toMatchObject({ recorded: 'join' });
    expect(createAttendance).toHaveBeenCalledWith(expect.objectContaining({
      connection_id: 'connection-1', location_id: 'location-1', meeting_id: '12345', participant_email: 'client@example.com', status: 'joined',
    }));
    expect(ingestCanonical).not.toHaveBeenCalled();
  });

  it('never turns the Zoom host into client attendance evidence', async () => {
    const payload = {
      event: 'meeting.participant_joined', event_ts: Date.now(),
      payload: { account_id: 'zoom-account', object: {
        id: 12345, uuid: 'meeting-instance', topic: 'Implementation Call', host_id: 'host-user',
        participant: {
          participant_uuid: 'host-instance', participant_user_id: 'host-user',
          email: 'merchant@example.com', join_time: '2026-07-11T14:00:00Z',
        },
      } },
    };

    await expect(zoomIntegrationService.handleWebhook(payload, Buffer.from(JSON.stringify(payload))))
      .resolves.toEqual({ accepted: true, ignored: true, reason: 'host_participant' });
    expect(createAttendance).not.toHaveBeenCalled();
    expect(ingestCanonical).not.toHaveBeenCalled();
  });

  it('turns a matching leave into one enrollment-resolvable attendance event', async () => {
    findOpenAttendance.mockResolvedValue({
      id: 'attendance-1', status: 'joined', joined_at: '2026-07-11T14:00:00Z', participant_email: 'client@example.com', meeting_topic: 'Implementation Call',
    });
    completeAttendance.mockImplementation(async (_connectionId, _id, updates) => ({
      id: 'attendance-1', joined_at: '2026-07-11T14:00:00Z', participant_email: 'client@example.com', meeting_topic: 'Implementation Call', ...updates,
    }));
    ingestCanonical.mockResolvedValue({ event: { id: 'intake-1' }, duplicate: false });
    const payload = {
      event: 'meeting.participant_left', event_ts: Date.now(),
      payload: { account_id: 'zoom-account', object: {
        id: 12345, uuid: 'meeting-instance', topic: 'Implementation Call',
        participant: { participant_uuid: 'participant-instance', registrant_id: 'registrant-1', email: 'client@example.com', leave_time: '2026-07-11T15:00:00Z' },
      } },
    };
    const raw = Buffer.from(JSON.stringify(payload));
    await expect(zoomIntegrationService.handleWebhook(payload, raw)).resolves.toMatchObject({ eventId: 'intake-1' });
    expect(ingestCanonical).toHaveBeenCalledWith(expect.objectContaining({ signatureVerified: true }), expect.objectContaining({
      event_type: 'session.attended',
      subject: { external_contact_id: 'zoom_registrant:registrant-1', email: 'client@example.com' },
      resource: { type: 'zoom_meeting', id: '12345', name: 'Implementation Call' },
      activity: expect.objectContaining({ duration_seconds: 3600 }),
    }), raw, false);
    expect(linkEvidenceEvent).toHaveBeenCalledWith('connection-1', 'attendance-1', 'intake-1');
  });

  it('quarantines a leave without a matching join instead of claiming attendance', async () => {
    findOpenAttendance.mockResolvedValue(null);
    createAttendance.mockResolvedValue({ id: 'attendance-orphan' });
    const payload = {
      event: 'meeting.participant_left', event_ts: Date.now(),
      payload: { account_id: 'zoom-account', object: {
        id: 12345, uuid: 'meeting-instance', topic: 'Implementation Call',
        participant: { participant_uuid: 'participant-instance', email: 'client@example.com', leave_time: '2026-07-11T15:00:00Z' },
      } },
    };
    const raw = Buffer.from(JSON.stringify(payload));

    await expect(zoomIntegrationService.handleWebhook(payload, raw)).resolves.toEqual({
      accepted: true,
      recorded: 'leave_without_join',
      evidencePublished: false,
    });
    expect(createAttendance).toHaveBeenCalledWith(expect.objectContaining({
      status: 'quarantined',
      left_at: '2026-07-11T15:00:00.000Z',
      duration_seconds: null,
    }));
    expect(completeAttendance).not.toHaveBeenCalled();
    expect(ingestCanonical).not.toHaveBeenCalled();
  });

  it('ignores events for a Zoom account that is not bound to an active tenant connection', async () => {
    getAuthorizationByAccount.mockResolvedValue(null);
    const payload = { event: 'meeting.participant_left', payload: { account_id: 'unknown' } };
    await expect(zoomIntegrationService.handleWebhook(payload, Buffer.from(JSON.stringify(payload))))
      .resolves.toEqual({ accepted: true, ignored: true });
    expect(ingestCanonical).not.toHaveBeenCalled();
  });

  describe('durable interval recovery', () => {
    let rows: any[];
    let events: Map<string, any>;
    const packet = (kind: 'joined' | 'left', time: string, accountId = 'zoom-account') => ({
      event: `meeting.participant_${kind}`, event_ts: Date.now(),
      payload: { account_id: accountId, object: {
        id: 12345, uuid: 'meeting-instance', topic: 'Group Call',
        participant: {
          participant_uuid: 'participant-instance', registrant_id: 'registrant-1', email: 'client@example.com',
          [kind === 'joined' ? 'join_time' : 'leave_time']: time,
        },
      } },
    });
    const deliver = (body: any) => zoomIntegrationService.handleWebhook(body, Buffer.from(JSON.stringify(body)));
    const join = () => deliver(packet('joined', '2026-10-01T14:00:00Z'));
    const leave = () => packet('left', '2026-10-01T14:30:00Z');

    beforeEach(() => {
      rows = [];
      events = new Map();
      createAttendance.mockImplementation(async (input) => {
        if (rows.some((row) => row.connection_id === input.connection_id && row.join_source_event_id === input.join_source_event_id)) return null;
        const row = { id: `attendance-${rows.length + 1}`, ...input };
        rows.push(row);
        return { ...row };
      });
      findAttendanceAt.mockImplementation(async (conn, meeting, participant, field, time) =>
        rows.find((row) => row.connection_id === conn && row.meeting_uuid === meeting &&
          row.participant_instance_id === participant && row[field] && Date.parse(row[field]) === Date.parse(time)) || null);
      findOpenAttendance.mockImplementation(async (conn, meeting, participant, leftAt) => {
        const row = rows.filter((r) => r.connection_id === conn && r.meeting_uuid === meeting &&
          r.participant_instance_id === participant && r.status === 'joined' &&
          (!leftAt || Date.parse(r.joined_at) <= Date.parse(leftAt)))
          .sort((a, b) => Date.parse(b.joined_at) - Date.parse(a.joined_at))[0];
        return row ? { ...row } : null;
      });
      completeAttendance.mockImplementation(async (conn, id, updates) => {
        const row = rows.find((r) => r.connection_id === conn && r.id === id && r.status === 'joined');
        if (!row) return null;
        Object.assign(row, updates);
        return { ...row };
      });
      ingestCanonical.mockImplementation(async (auth, canonical) => {
        const key = `${auth.connection.id}:${canonical.event_id}`;
        const existing = events.get(key);
        if (existing) return { event: existing, duplicate: true };
        const event = { id: `event-${events.size + 1}`, canonical };
        events.set(key, event);
        return { event, duplicate: false };
      });
      linkEvidenceEvent.mockImplementation(async (conn, id, eventId) => {
        const row = rows.find((r) => r.connection_id === conn && r.id === id && r.status === 'completed');
        if (row) Object.assign(row, { status: 'published', evidence_event_id: eventId });
      });
    });

    it('resumes a completed interval after canonical intake fails', async () => {
      await join();
      ingestCanonical.mockRejectedValueOnce(new Error('intake unavailable'));
      await expect(deliver(leave())).rejects.toThrow('intake unavailable');
      expect(rows[0].status).toBe('completed');
      await expect(deliver(leave())).resolves.toMatchObject({ eventId: 'event-1' });
      expect(rows).toHaveLength(1);
      expect(rows[0].status).toBe('published');
      expect(events.size).toBe(1);
    });

    it('retries a failure before closing the interval without losing the join', async () => {
      await join();
      completeAttendance.mockRejectedValueOnce(new Error('database unavailable'));
      await expect(deliver(leave())).rejects.toThrow('database unavailable');
      expect(rows[0].status).toBe('joined');
      await expect(deliver(leave())).resolves.toMatchObject({ eventId: 'event-1' });
      expect(rows).toHaveLength(1);
    });

    it('recovers when completion committed but its response was lost', async () => {
      await join();
      completeAttendance.mockImplementationOnce(async (_conn, _id, updates) => {
        Object.assign(rows[0], updates);
        throw new Error('response lost');
      });
      await expect(deliver(leave())).rejects.toThrow('response lost');
      await expect(deliver(leave())).resolves.toMatchObject({ eventId: 'event-1' });
      expect(rows).toHaveLength(1);
      expect(events.size).toBe(1);
    });

    it('does not call rejected evidence published', async () => {
      await join();
      ingestCanonical.mockResolvedValueOnce({ event: { id: 'rejected-event', status: 'rejected' }, duplicate: true });
      await expect(deliver(leave())).rejects.toThrow('intake was rejected');
      expect(rows[0].status).toBe('completed');
      expect(linkEvidenceEvent).not.toHaveBeenCalled();
    });

    it('deduplicates simultaneous joins using the existing unique database key', async () => {
      await Promise.all([join(), join()]);
      expect(rows).toHaveLength(1);
      expect(ingestCanonical).not.toHaveBeenCalled();
    });

    it('recovers after intake succeeds but linking fails without creating a second event', async () => {
      await join();
      linkEvidenceEvent.mockRejectedValueOnce(new Error('link unavailable'));
      await expect(deliver(leave())).rejects.toThrow('link unavailable');
      await expect(deliver(leave())).resolves.toMatchObject({ eventId: 'event-1', duplicate: true });
      expect(events.size).toBe(1);
      expect(rows[0].status).toBe('published');
    });

    it('handles concurrent leave deliveries through one completion and one canonical event', async () => {
      await join();
      const results = await Promise.all([deliver(leave()), deliver(leave())]);
      expect(results.map((r) => r.eventId)).toEqual(['event-1', 'event-1']);
      expect(events.size).toBe(1);
      expect(rows).toHaveLength(1);
      expect(rows[0].duration_seconds).toBe(1800);
    });

    it('deduplicates retries with different delivery metadata and preserves a later rejoin', async () => {
      await join();
      await deliver(leave());
      const rejoin = packet('joined', '2026-10-01T14:40:00Z');
      await deliver(rejoin);
      await deliver({ ...rejoin, event_ts: 9999999999999 });
      await expect(deliver({ ...leave(), event_ts: 9999999999999 })).resolves.toMatchObject({ duplicate: true });
      expect(rows).toHaveLength(2);
      expect(rows[1].status).toBe('joined');
      await deliver(packet('left', '2026-10-01T15:00:00Z'));
      expect(events.size).toBe(2);
      expect(rows.map((r) => r.duration_seconds)).toEqual([1800, 1200]);
    });

    it('recovers a pre-upgrade completed row using its existing canonical event identity', async () => {
      await join();
      rows[0] = {
        ...rows[0], status: 'completed', left_at: '2026-10-01T14:30:00Z',
        duration_seconds: 1800, leave_source_event_id: 'zoom:legacy-raw-body-hash',
      };
      await deliver(leave());
      expect(ingestCanonical.mock.calls[0][1].event_id).toBe('zoom:legacy-raw-body-hash');
      expect(rows[0].status).toBe('published');
    });

    it('does not use another tenant connection with identical meeting and participant IDs', async () => {
      await join();
      getAuthorizationByAccount.mockResolvedValue({ id: 'auth-2', connection: {
        ...connection, id: 'connection-2', location_id: 'location-2',
      } });
      await expect(deliver(leave())).resolves.toMatchObject({ recorded: 'leave_without_join' });
      expect(ingestCanonical).not.toHaveBeenCalled();
      expect(rows[0].status).toBe('joined');
    });

    it('does not complete a newer join with an older leave notification', async () => {
      await deliver(packet('joined', '2026-10-01T15:00:00Z'));
      await expect(deliver(leave())).resolves.toMatchObject({ recorded: 'leave_without_join' });
      expect(rows[0].status).toBe('joined');
      expect(ingestCanonical).not.toHaveBeenCalled();
    });

    it('rejects invalid provider timestamps without inventing an occurrence time', async () => {
      await expect(deliver(packet('left', 'invalid-time'))).rejects.toThrow('valid occurrence time');
      expect(createAttendance).not.toHaveBeenCalled();
    });
  });
});
