const findResourceMapping = jest.fn();
const findSubjectsByIdentity = jest.fn();
const findSubjectsByEmail = jest.fn();
const getSubjectByEnrollment = jest.fn();
const findMeetingCandidates = jest.fn();

jest.mock('../../src/repositories/evidence-connector.repository', () => ({
  evidenceConnectorRepository: {
    findResourceMapping: (...args: any[]) => findResourceMapping(...args),
    findSubjectsByIdentity: (...args: any[]) => findSubjectsByIdentity(...args),
    findSubjectsByEmail: (...args: any[]) => findSubjectsByEmail(...args),
    getSubjectByEnrollment: (...args: any[]) => getSubjectByEnrollment(...args),
  },
}));

jest.mock('../../src/repositories/scheduling-event.repository', () => ({
  schedulingEventRepository: {
    findMeetingCandidates: (...args: any[]) => findMeetingCandidates(...args),
  },
}));

jest.mock('../../src/services/evidence-event-materializer', () => ({ materializeExternalEvidence: jest.fn() }));
jest.mock('../../src/services/evidence.service', () => ({ evidenceService: {} }));
jest.mock('../../src/services/external-evidence-attachment.service', () => ({ externalEvidenceAttachmentService: {} }));

import { resolveConnectorSubject } from '../../src/services/evidence-connector-worker';
import { CanonicalEvidenceEvent, EvidenceConnectionRecord } from '../../src/types/evidence-connector.types';

const connection = {
  id: 'zoom-connection',
  location_id: 'location-1',
  provider_key: 'zoom',
} as EvidenceConnectionRecord;

function event(name = 'Weekly Client Call'): CanonicalEvidenceEvent {
  return {
    schema_version: '1.0',
    event_id: 'zoom-event-1',
    event_type: 'session.attended',
    occurred_at: '2026-07-11T15:00:00Z',
    subject: { external_contact_id: 'zoom_user_1', email: 'client@example.com' },
    resource: { type: 'zoom_meeting', id: 'meeting-1', name },
  };
}

function subject(id: string, offerName: string, deliveryMethod = 'Live Virtual (Zoom/Meet)') {
  return {
    id,
    offer_id: `offer-${id}`,
    enrollment: {
      id: `enrollment-${id}`,
      status: 'enrolled',
      enrolled_at: '2026-07-01T00:00:00Z',
      cancelled_at: null,
      completed_at: null,
    },
    offer: { id: `offer-${id}`, offer_name: offerName, delivery_method: deliveryMethod },
  };
}

describe('automatic Zoom enrollment resolution', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    findResourceMapping.mockResolvedValue(null);
    findSubjectsByIdentity.mockResolvedValue([]);
    findMeetingCandidates.mockResolvedValue([]);
    getSubjectByEnrollment.mockResolvedValue(null);
  });

  it('uses an exact scheduled appointment even when Zoom omits participant email', async () => {
    const scheduledSubject = subject('scheduled', 'Private Coaching');
    findMeetingCandidates.mockResolvedValue([{ id: 'schedule-1', enrollment_id: 'enrollment-scheduled' }]);
    getSubjectByEnrollment.mockResolvedValue(scheduledSubject);
    findSubjectsByEmail.mockResolvedValue([]);
    const scheduledEvent = event('Private Session');
    scheduledEvent.subject = { external_contact_id: 'zoom_participant_1' };

    await expect(resolveConnectorSubject(connection, scheduledEvent)).resolves.toMatchObject({
      subject: { id: 'scheduled' },
      method: 'zoom_exact_scheduled_appointment',
    });
  });

  it('uses the only eligible enrollment for the participant email', async () => {
    findSubjectsByEmail.mockResolvedValue([subject('one', 'Coaching Program')]);
    await expect(resolveConnectorSubject(connection, event())).resolves.toMatchObject({
      subject: { id: 'one' },
      method: 'zoom_exact_email_unique_enrollment',
    });
  });

  it('uses an exact meeting-topic and offer-name match when the client has multiple programs', async () => {
    findSubjectsByEmail.mockResolvedValue([
      subject('one', 'Coaching Program'),
      subject('two', 'Implementation Call'),
    ]);
    await expect(resolveConnectorSubject(connection, event('Implementation Call'))).resolves.toMatchObject({
      subject: { id: 'two' },
      method: 'zoom_email_and_exact_offer_name',
    });
  });

  it('quarantines an ambiguous generic meeting instead of guessing', async () => {
    findSubjectsByEmail.mockResolvedValue([
      subject('one', 'Program One'),
      subject('two', 'Program Two'),
    ]);
    await expect(resolveConnectorSubject(connection, event('Weekly Call'))).rejects.toMatchObject({
      code: 'AMBIGUOUS_ZOOM_ENROLLMENT',
      retryable: false,
    });
  });
});
