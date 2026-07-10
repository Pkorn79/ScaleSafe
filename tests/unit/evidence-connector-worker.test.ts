jest.mock('../../src/repositories/evidence-connector.repository', () => ({
  evidenceConnectorRepository: {
    findSubjectByRef: jest.fn(),
    findSubjectsByIdentity: jest.fn(),
    findResourceMapping: jest.fn(),
    findSubjectsByEmailAndOffer: jest.fn(),
  },
}));

jest.mock('../../src/services/evidence.service', () => ({ evidenceService: { logEvidence: jest.fn() } }));
jest.mock('../../src/services/external-evidence-attachment.service', () => ({
  externalEvidenceAttachmentService: { processEventAttachments: jest.fn() },
}));

import { evidenceConnectorRepository } from '../../src/repositories/evidence-connector.repository';
import { resolveConnectorSubject } from '../../src/services/evidence-connector-worker';
import { CanonicalEvidenceEvent, EvidenceConnectionRecord } from '../../src/types/evidence-connector.types';

const repository = evidenceConnectorRepository as jest.Mocked<typeof evidenceConnectorRepository>;
const connection = {
  id: 'connection-1',
  location_id: 'location-1',
  status: 'active',
} as EvidenceConnectionRecord;

function event(overrides: Partial<CanonicalEvidenceEvent> = {}): CanonicalEvidenceEvent {
  return {
    schema_version: '1.0',
    event_id: 'evt-1',
    event_type: 'session.completed',
    occurred_at: '2026-07-10T14:30:00Z',
    subject: { enrollment_ref: 'enrollment-ref' },
    resource: { type: 'course', id: 'course-1' },
    ...overrides,
  };
}

describe('evidence connector enrollment resolution', () => {
  beforeEach(() => jest.clearAllMocks());

  it('uses a tenant-bound enrollment reference first', async () => {
    const subject = { id: 'subject-1', enrollment_id: 'enrollment-1' };
    repository.findSubjectByRef.mockResolvedValue(subject);

    await expect(resolveConnectorSubject(connection, event())).resolves.toEqual({
      subject,
      method: 'enrollment_ref',
    });
    expect(repository.findSubjectByRef).toHaveBeenCalledWith('location-1', 'enrollment-ref');
    expect(repository.findResourceMapping).not.toHaveBeenCalled();
  });

  it('resolves a persisted external contact only through the mapped resource offer', async () => {
    repository.findResourceMapping.mockResolvedValue({ offer_id: 'offer-2' });
    repository.findSubjectsByIdentity.mockResolvedValue([
      { id: 'subject-1', offer_id: 'offer-1' },
      { id: 'subject-2', offer_id: 'offer-2' },
    ]);

    await expect(resolveConnectorSubject(connection, event({
      subject: { external_contact_id: 'external-contact' },
    }))).resolves.toEqual({
      subject: { id: 'subject-2', offer_id: 'offer-2' },
      method: 'external_contact_and_resource',
    });
  });

  it('quarantines ambiguous email and offer matches instead of choosing the newest enrollment', async () => {
    repository.findResourceMapping.mockResolvedValue({ offer_id: 'offer-1' });
    repository.findSubjectsByEmailAndOffer.mockResolvedValue([
      { id: 'older-subject', offer_id: 'offer-1' },
      { id: 'newer-subject', offer_id: 'offer-1' },
    ]);

    await expect(resolveConnectorSubject(connection, event({
      subject: { email: 'client@example.com' },
    }))).rejects.toMatchObject({ code: 'AMBIGUOUS_EMAIL_AND_OFFER', retryable: false });
  });

  it('marks a missing enrollment as retryable when identity and offer are exact', async () => {
    repository.findResourceMapping.mockResolvedValue({ offer_id: 'offer-1' });
    repository.findSubjectsByEmailAndOffer.mockResolvedValue([]);

    await expect(resolveConnectorSubject(connection, event({
      subject: { email: 'client@example.com' },
    }))).rejects.toMatchObject({ code: 'ENROLLMENT_NOT_READY', retryable: true });
  });
});
