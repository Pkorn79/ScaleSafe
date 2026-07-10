import { materializeExternalEvidence } from '../../src/services/evidence-event-materializer';

const connection: any = {
  id: 'connection-1', location_id: 'loc-1', source_label: 'Meeting System',
};
const intake: any = {
  id: 'event-row-1', location_id: 'loc-1', received_at: '2026-07-10T14:31:00Z',
  auth_method: 'api_key', signature_verified: false, payload_hash: 'abc', resolution_method: 'enrollment_ref',
};
const subject: any = {
  id: 'subject-1',
  enrollment: { id: 'enrollment-1', contact_id: 'contact-1', offer_id: 'offer-1', offer_name: 'Program' },
};

describe('external evidence materializer', () => {
  it('creates enrollment-scoped factual session evidence', () => {
    const result = materializeExternalEvidence({
      connection,
      intake,
      subject,
      event: {
        schema_version: '1.0', event_id: 'provider-1', event_type: 'session.completed',
        occurred_at: '2026-07-10T14:30:00Z', subject: { enrollment_ref: 'ref' },
        resource: { type: 'coaching', id: 'session-1', name: 'Implementation Call' },
        actor: { type: 'client' }, activity: { status: 'completed', duration_seconds: 3600 },
      },
    });
    expect(result.table).toBe('evidence_external_sessions');
    expect(result.record).toEqual(expect.objectContaining({
      location_id: 'loc-1', contact_id: 'contact-1', enrollment_id: 'enrollment-1', connector_event_id: 'event-row-1',
    }));
    expect(result.record.defense_summary).toContain('Meeting System reported');
    expect(result.record.defense_metadata).toEqual(expect.objectContaining({
      connector: expect.objectContaining({ resolutionMethod: 'enrollment_ref' }),
    }));
  });

  it('marks payment observations as supplemental evidence only', () => {
    const result = materializeExternalEvidence({
      connection,
      intake,
      subject,
      event: {
        schema_version: '1.0', event_id: 'provider-2', event_type: 'payment.observed',
        occurred_at: '2026-07-10T14:30:00Z', subject: { enrollment_ref: 'ref' },
        metadata: { amount: 100, currency: 'USD' },
      },
    });
    expect(result.table).toBe('evidence_payment_confirmation');
    expect(result.record.defense_summary).toContain('does not alter ScaleSafe payment state');
  });
});
