/**
 * Exhibit ordering + timeline tests.
 * Exhibits must lead with the most persuasive evidence for the specific reason
 * code (evidence_priorities), and the transaction timeline must be chronological
 * with disputed-charge/dispute-filed markers.
 */

jest.mock('../../src/clients/supabase.client', () => ({
  getSupabase: () => ({ from: jest.fn() }),
}));

import {
  sortExhibitsByPriority,
  normalizeEvidencePriorities,
  buildTimelineRows,
  type ExhibitEntry,
} from '../../src/services/defense-exhibits.service';

function ex(source: string, name: string, occurredAt = '2026-01-01'): ExhibitEntry {
  return {
    letter: '?',
    name,
    category: 'consent',
    source: source as any,
    ref: name,
    occurredAt,
    summary: name,
  };
}

describe('sortExhibitsByPriority', () => {
  test('13.6-style priorities put the refund record first, consent later', () => {
    const exhibits = [
      ex('enrollment_packet_pdf', 'packet'),
      ex('evidence_sessions', 'session'),
      ex('evidence_refund_activity', 'refund'),
      ex('evidence_communication', 'comm'),
    ];
    // Priorities for credit_not_processed lead with refund policy/records
    sortExhibitsByPriority(exhibits, ['refund_policy', 'cancellation', 'consent', 'communication']);
    expect(exhibits[0].name).toBe('refund');
    expect(exhibits[1].name).toBe('packet'); // consent
    expect(exhibits[2].name).toBe('comm');
    expect(exhibits[3].name).toBe('session'); // unmatched → last
  });

  test('13.2-style priorities put the cancellation ledger first', () => {
    const exhibits = [
      ex('evidence_sessions', 'session'),
      ex('enrollment_packet_pdf', 'packet'),
      ex('evidence_cancellation', 'cancel'),
    ];
    sortExhibitsByPriority(exhibits, ['cancellation', 'consent', 'service_access', 'sessions']);
    expect(exhibits.map(e => e.name)).toEqual(['cancel', 'packet', 'session']);
  });

  test('sort is stable within a rank (chronology preserved)', () => {
    const exhibits = [
      ex('evidence_sessions', 's1', '2026-01-01'),
      ex('evidence_sessions', 's2', '2026-01-02'),
      ex('evidence_sessions', 's3', '2026-01-03'),
    ];
    sortExhibitsByPriority(exhibits, ['sessions']);
    expect(exhibits.map(e => e.name)).toEqual(['s1', 's2', 's3']);
  });
});

describe('normalizeEvidencePriorities', () => {
  test('accepts arrays, JSON strings, and garbage', () => {
    expect(normalizeEvidencePriorities(['a', 'b'])).toEqual(['a', 'b']);
    expect(normalizeEvidencePriorities('["a","b"]')).toEqual(['a', 'b']);
    expect(normalizeEvidencePriorities('not json')).toEqual([]);
    expect(normalizeEvidencePriorities(null)).toEqual([]);
    expect(normalizeEvidencePriorities(undefined)).toEqual([]);
    expect(normalizeEvidencePriorities([1, 'a', null])).toEqual(['a']);
  });
});

describe('buildTimelineRows', () => {
  test('rows are chronological with markers for the charge and the dispute', () => {
    const exhibits = [
      ex('evidence_sessions', 'Session 2', '2026-02-10'),
      ex('enrollment_packet_pdf', 'Enrollment', '2026-01-05'),
    ];
    exhibits[0].letter = 'B';
    exhibits[1].letter = 'A';

    const rows = buildTimelineRows(exhibits, {
      transactionDate: '2026-01-05T10:00:00Z',
      disputeDate: '2026-03-01',
    });

    expect(rows.map(r => r.label)).toEqual([
      'Enrollment',
      'Disputed charge',
      'Session 2',
      'Chargeback filed by cardholder',
    ]);
    expect(rows.find(r => r.label === 'Disputed charge')?.isMarker).toBe(true);
    expect(rows.find(r => r.label === 'Session 2')?.exhibitLetter).toBe('B');
  });

  test('exhibits without dates and invalid dates are excluded', () => {
    const noDate = ex('evidence_sessions', 'undated');
    (noDate as any).occurredAt = null;
    const badDate = ex('evidence_sessions', 'bad', 'not-a-date');
    const rows = buildTimelineRows([noDate, badDate], { disputeDate: '2026-03-01' });
    expect(rows.map(r => r.label)).toEqual(['Chargeback filed by cardholder']);
  });
});
