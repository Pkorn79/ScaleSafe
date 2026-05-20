import {
  buildDefenseEvidenceFields,
  getDefenseSummary,
  normalizeReasonCodeTags,
} from '../../src/utils/defense-evidence';

describe('defense evidence contract helpers', () => {
  it('normalizes reason-code tags and drops unknown values', () => {
    expect(normalizeReasonCodeTags([
      'Fraud',
      'services-not-provided',
      'fraud',
      'not a real tag',
    ])).toEqual(['fraud', 'services_not_provided']);
  });

  it('builds stable defense metadata fields from explicit and nested inputs', () => {
    const fields = buildDefenseEvidenceFields({
      summary: 'Client accessed the service portal after enrollment.',
      proofRole: 'service_access',
      relevance: { tags: ['fraud', 'services_not_provided'], priority: 'high' },
      metadata: {
        actor: 'client',
        service: { enrollmentId: 'enr_123', offerName: 'Coaching Program' },
        transaction: { paymentEventId: 'pay_123', transactionId: 'txn_123' },
        source: { system: 'platform', recordId: 'access_123' },
      },
    });

    expect(fields.enrollment_id).toBe('enr_123');
    expect(fields.payment_event_id).toBe('pay_123');
    expect(fields.reason_code_tags).toEqual(['fraud', 'services_not_provided']);
    expect(fields.source_record_id).toBe('access_123');
    expect(fields.actor).toBe('client');
    expect(fields.issuer_exhibit_title).toBe('Client accessed the service portal after enrollment.');
  });

  it('prefers defense_summary when summarizing mixed legacy rows', () => {
    expect(getDefenseSummary({
      defense_summary: 'Defense-ready sentence',
      description: 'Older description',
      data: { summary: 'JSON summary' },
    })).toBe('Defense-ready sentence');
  });
});
