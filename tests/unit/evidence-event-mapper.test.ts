import { mapConfiguredRawWebhook, mapRawWebhook, readSafePath, validateCanonicalEvent } from '../../src/utils/evidence-event-mapper';

describe('evidence event mapper', () => {
  it('maps a provider payload without executing expressions', () => {
    const event = mapRawWebhook({
      id: 'evt_1',
      type: 'meeting.ended',
      timestamp: '2026-07-10T14:30:00Z',
      attendee: { email: 'Client@Example.com' },
      meeting: { id: 'm_1', name: 'Implementation Call' },
    }, {
      eventIdPath: 'id',
      eventTypePath: 'type',
      eventTypeMap: { 'meeting.ended': 'session.completed' },
      occurredAtPath: 'timestamp',
      contactEmailPath: 'attendee.email',
      resourceTypeValue: 'meeting',
      resourceIdPath: 'meeting.id',
      resourceNamePath: 'meeting.name',
      actorTypeValue: 'provider',
    });

    expect(event.event_id).toBe('evt_1');
    expect(event.event_type).toBe('session.completed');
    expect(event.subject.email).toBe('client@example.com');
    expect(event.resource).toEqual(expect.objectContaining({ id: 'm_1', name: 'Implementation Call' }));
    expect(validateCanonicalEvent(event)).toEqual([]);
  });

  it('blocks prototype traversal and unapproved custom events', () => {
    expect(readSafePath({}, '__proto__.polluted')).toBeUndefined();
    const errors = validateCanonicalEvent({
      schema_version: '1.0',
      event_id: 'evt_2',
      event_type: 'custom.claimed_win',
      occurred_at: '2026-07-10T14:30:00Z',
      subject: { enrollment_ref: 'ref' },
    });
    expect(errors).toContain('event_type is not supported or approved by this connection');
  });

  it('selects different safe mapping rules for different provider payload shapes', () => {
    const config = {
      mappings: [
        {
          name: 'Meeting ended', matchPath: 'kind', matchValue: 'meeting',
          eventIdPath: 'meeting.id', eventTypeValue: 'session.completed', occurredAtPath: 'meeting.ended_at',
          enrollmentRefPath: 'meeting.enrollment_ref',
        },
        {
          name: 'File downloaded', matchPath: 'kind', matchValue: 'download',
          eventIdPath: 'download.id', eventTypeValue: 'content.downloaded', occurredAtPath: 'download.at',
          enrollmentRefPath: 'download.enrollment_ref', resourceIdPath: 'download.file_id',
        },
      ],
    };

    expect(mapConfiguredRawWebhook({
      kind: 'meeting', meeting: { id: 'm-1', ended_at: '2026-07-10T14:30:00Z', enrollment_ref: 'ref' },
    }, config)?.event_type).toBe('session.completed');
    expect(mapConfiguredRawWebhook({
      kind: 'download', download: { id: 'd-1', at: '2026-07-10T15:30:00Z', enrollment_ref: 'ref', file_id: 'f-1' },
    }, config)?.event_type).toBe('content.downloaded');
    expect(mapConfiguredRawWebhook({ kind: 'unknown' }, config)).toBeNull();
  });

  it('rejects unsafe or credential-bearing attachment URLs', () => {
    const base = {
      schema_version: '1.0' as const,
      event_id: 'evt_attachment',
      event_type: 'deliverable.sent',
      occurred_at: '2026-07-10T14:30:00Z',
      subject: { enrollment_ref: 'ref' },
    };

    expect(validateCanonicalEvent({
      ...base,
      attachments: [{ url: 'http://files.example.com/proof.pdf' }],
    })).toContain('attachment URLs must be credential-free HTTPS URLs without query strings');

    expect(validateCanonicalEvent({
      ...base,
      attachments: [{ url: 'https://files.example.com/proof.pdf?token=secret' }],
    })).toContain('attachment URLs must be credential-free HTTPS URLs without query strings');

    expect(validateCanonicalEvent({
      ...base,
      attachments: [{ url: 'https://files.example.com/proof.pdf' }],
    })).toEqual([]);
  });
});
