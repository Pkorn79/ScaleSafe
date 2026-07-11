import { isMerchantVisibleEvidenceRow } from '../../src/repositories/evidence.repository';

describe('evidence timeline visibility', () => {
  test('hides internal evidence readiness threshold bookkeeping', () => {
    expect(isMerchantVisibleEvidenceRow({
      evidence_type: 'custom_event',
      data: { event_type: 'evidence_milestone', milestone_threshold: 25 },
    })).toBe(false);
  });

  test('keeps real custom activity and typed appointment evidence visible', () => {
    expect(isMerchantVisibleEvidenceRow({
      evidence_type: 'custom_event',
      data: { event_type: 'deliverable_viewed' },
    })).toBe(true);
    expect(isMerchantVisibleEvidenceRow({
      evidence_type: 'appointment',
      data: { appointment_title: 'Implementation Call' },
    })).toBe(true);
  });
});
