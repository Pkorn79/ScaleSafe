/**
 * Exhibit scoping fail-safe tests (scopedRows).
 * Guards the regression where a missing enrollment id caused every contact-wide
 * evidence row to be dumped into the defense packet.
 */

jest.mock('../../src/clients/supabase.client', () => ({
  getSupabase: () => ({ from: jest.fn() }),
}));

import { scopedRows } from '../../src/services/defense-exhibits.service';

const rows = [
  { id: 'r1', enrollment_id: 'enr_target', created_at: '2026-01-10' },
  { id: 'r2', enrollment_id: 'enr_sibling', created_at: '2026-01-11' },
  { id: 'r3', enrollment_id: null, created_at: '2026-01-12' },
];

describe('scopedRows fail-safe', () => {
  test('missing enrollmentId with non-contact_only scope returns NOTHING (no contact-wide dump)', () => {
    const result = scopedRows(rows, undefined, 'created_at', null, null, null, 'inferred');
    expect(result).toEqual([]);
  });

  test('missing enrollmentId is only allowed to return rows under explicit contact_only scope', () => {
    const result = scopedRows(rows, undefined, 'created_at', null, null, null, 'contact_only');
    expect(result).toHaveLength(3);
  });

  test('with an enrollmentId, sibling-enrollment evidence is excluded', () => {
    const result = scopedRows(rows, 'enr_target', 'created_at', null, null, null, 'exact');
    const ids = result.map((r) => r.id);
    expect(ids).toContain('r1'); // same enrollment
    expect(ids).not.toContain('r2'); // sibling enrollment excluded
  });

  test('legacy rows with the enrollment id only in raw_payload are included for exact scope', () => {
    const legacy = [
      { id: 'legacy_match', enrollment_id: null, raw_payload: { enrollmentId: 'enr_target' }, created_at: '2026-01-10' },
      { id: 'legacy_snake', enrollment_id: null, raw_payload: { enrollment_id: 'enr_target' }, created_at: '2026-01-11' },
      { id: 'legacy_other', enrollment_id: null, raw_payload: { enrollmentId: 'enr_sibling' }, created_at: '2026-01-12' },
    ];
    const result = scopedRows(legacy, 'enr_target', 'created_at', null, null, null, 'exact');
    expect(result.map((r) => r.id)).toEqual(['legacy_match', 'legacy_snake']);
  });

  test('unlinked rows within the enrollment window are included; outside are excluded', () => {
    const windowStart = new Date('2026-01-01');
    const windowEnd = new Date('2026-01-31');
    const within = scopedRows(
      [{ id: 'x', enrollment_id: null, created_at: '2026-01-15' }],
      'enr_target', 'created_at', windowStart, windowEnd, null, 'exact',
    );
    expect(within.map((r) => r.id)).toEqual(['x']);

    const outside = scopedRows(
      [{ id: 'y', enrollment_id: null, created_at: '2026-05-15' }],
      'enr_target', 'created_at', windowStart, windowEnd, null, 'exact',
    );
    expect(outside).toEqual([]);
  });
});
