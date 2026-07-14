import crypto from 'crypto';

const getAuthorizationByAccount = jest.fn();
const createAttendance = jest.fn();
const findOpenAttendance = jest.fn();
const completeAttendance = jest.fn();
const linkEvidenceEvent = jest.fn();
const ingestCanonical = jest.fn();

jest.mock('../../src/repositories/zoom-integration.repository', () => ({
  zoomIntegrationRepository: {
    getAuthorizationByAccount: (...args: any[]) => getAuthorizationByAccount(...args),
    createAttendance: (...args: any[]) => createAttendance(...args),
    findOpenAttendance: (...args: any[]) => findOpenAttendance(...args),
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
    jest.clearAllMocks();
    getAuthorizationByAccount.mockResolvedValue({ id: 'auth-1', connection });
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
      id: 'attendance-1', joined_at: '2026-07-11T14:00:00Z', participant_email: 'client@example.com', meeting_topic: 'Implementation Call',
    });
    completeAttendance.mockImplementation(async (_id, updates) => ({
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
    expect(linkEvidenceEvent).toHaveBeenCalledWith('attendance-1', 'intake-1');
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
      left_at: '2026-07-11T15:00:00Z',
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
});
