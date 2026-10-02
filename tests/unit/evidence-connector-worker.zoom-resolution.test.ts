const findResourceMapping = jest.fn();
const findSubjectsByIdentity = jest.fn();
const findSubjectsByEmail = jest.fn();
const findSubjectsByEmailAndOffer = jest.fn();
const findSubjectByRef = jest.fn();
const getSubjectByEnrollment = jest.fn();
const findMeetingCandidates = jest.fn();

jest.mock('../../src/repositories/evidence-connector.repository', () => ({
  evidenceConnectorRepository: {
    findResourceMapping: (...args: any[]) => findResourceMapping(...args),
    findSubjectsByIdentity: (...args: any[]) => findSubjectsByIdentity(...args),
    findSubjectsByEmail: (...args: any[]) => findSubjectsByEmail(...args),
    findSubjectsByEmailAndOffer: (...args: any[]) => findSubjectsByEmailAndOffer(...args),
    findSubjectByRef: (...args: any[]) => findSubjectByRef(...args),
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
    location_id: 'location-1',
    normalized_email: 'client@example.com',
    offer_id: `offer-${id}`,
    enrollment: {
      id: `enrollment-${id}`,
      location_id: 'location-1',
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
    findSubjectsByEmail.mockResolvedValue([]);
    findSubjectsByEmailAndOffer.mockResolvedValue([]);
    findSubjectByRef.mockResolvedValue(null);
    findMeetingCandidates.mockResolvedValue([]);
    getSubjectByEnrollment.mockResolvedValue(null);
  });

  it('does not identify a person from a sole scheduled appointment when email is missing', async () => {
    const scheduledSubject = subject('scheduled', 'Private Coaching');
    findMeetingCandidates.mockResolvedValue([{ id: 'schedule-1', enrollment_id: 'enrollment-scheduled' }]);
    getSubjectByEnrollment.mockResolvedValue(scheduledSubject);
    findSubjectsByEmail.mockResolvedValue([]);
    const scheduledEvent = event('Private Session');
    scheduledEvent.subject = { external_contact_id: 'zoom_participant_1' };

    await expect(resolveConnectorSubject(connection, scheduledEvent)).rejects.toMatchObject({
      code: 'ZOOM_PARTICIPANT_EMAIL_MISSING',
    });
  });

  it('preserves explicit tenant-scoped enrollment references used by connector tests', async () => {
    findSubjectByRef.mockResolvedValue(subject('one', 'One'));
    const explicit = event();
    explicit.subject = { enrollment_ref: 'explicit-reference' };
    await expect(resolveConnectorSubject(connection, explicit)).resolves.toMatchObject({ subject: { id: 'one' }, method: 'enrollment_ref' });
    expect(findSubjectByRef).toHaveBeenCalledWith('location-1', 'explicit-reference');
  });

  it('does not assign Bob to Alice just because Alice booked the shared meeting', async () => {
    findMeetingCandidates.mockResolvedValue([{ enrollment_id: 'enrollment-alice' }]);
    getSubjectByEnrollment.mockResolvedValue({ ...subject('alice', 'Private Session'), normalized_email: 'alice@example.com' });
    const bob = event();
    bob.subject.email = 'bob@example.com';
    await expect(resolveConnectorSubject(connection, bob)).rejects.toMatchObject({ code: 'ZOOM_ENROLLMENT_NOT_READY' });
  });

  it('uses the scheduled program only among enrollments matching this participant', async () => {
    findMeetingCandidates.mockResolvedValue([{ enrollment_id: 'enrollment-two' }]);
    findSubjectsByEmail.mockResolvedValue([subject('one', 'One'), subject('two', 'Two')]);
    await expect(resolveConnectorSubject(connection, event())).resolves.toMatchObject({
      subject: { id: 'two' }, method: 'zoom_scheduled_appointment_and_email',
    });
  });

  it('ignores legacy identity bindings that disagree with the current participant email', async () => {
    findSubjectsByIdentity.mockResolvedValue([subject('wrong-client', 'Private Session')]);
    findSubjectsByEmail.mockResolvedValue([subject('right-client', 'Private Session')]);
    await expect(resolveConnectorSubject(connection, event())).resolves.toMatchObject({ subject: { id: 'right-client' } });
    expect(findSubjectsByIdentity).not.toHaveBeenCalled();
  });

  it('requires participant email even when the meeting has an offer mapping and an old binding', async () => {
    findResourceMapping.mockResolvedValue({ offer_id: 'offer-one' });
    findSubjectsByIdentity.mockResolvedValue([subject('one', 'One')]);
    const missingEmail = event();
    delete missingEmail.subject.email;
    await expect(resolveConnectorSubject(connection, missingEmail)).rejects.toMatchObject({ code: 'ZOOM_PARTICIPANT_EMAIL_MISSING' });
  });

  it('resolves a mapped meeting using the participant and offer in the current tenant', async () => {
    findResourceMapping.mockResolvedValue({ offer_id: 'offer-one' });
    findSubjectsByEmailAndOffer.mockResolvedValue([subject('one', 'One')]);
    await expect(resolveConnectorSubject(connection, event())).resolves.toMatchObject({ subject: { id: 'one' }, method: 'exact_email_and_offer' });
    expect(findSubjectsByEmailAndOffer).toHaveBeenCalledWith('location-1', 'client@example.com', 'offer-one');
  });

  it.each(['subject', 'enrollment'])('rejects a foreign %s returned by a lookup', async (part) => {
    const other: any = subject('other', 'Other');
    if (part === 'subject') other.location_id = 'other-location';
    else other.enrollment.location_id = 'other-location';
    findSubjectsByEmail.mockResolvedValue([other]);
    await expect(resolveConnectorSubject(connection, event())).rejects.toMatchObject({ code: 'ZOOM_ENROLLMENT_NOT_READY' });
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
