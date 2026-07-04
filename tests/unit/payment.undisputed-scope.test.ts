/**
 * getUndisputedPayments enrollment-scoping tests.
 * When an enrollmentId is supplied, same-enrollment payments must lead (primary
 * evidence) and other-enrollment payments must follow (secondary relationship
 * evidence) — never interleaved or dropped.
 */

const rows = [
  { id: 'p1', amount: 100, enrollment_id: 'enr_other', created_at: '2026-01-01' },
  { id: 'p2', amount: 200, enrollment_id: 'enr_target', created_at: '2026-01-02' },
  { id: 'p3', amount: 300, enrollment_id: 'enr_other', created_at: '2026-01-03' },
  { id: 'p4', amount: 400, enrollment_id: 'enr_target', created_at: '2026-01-04' },
];

jest.mock('../../src/clients/supabase.client', () => ({
  getSupabase: () => ({
    from: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            order: jest.fn().mockResolvedValue({ data: rows, error: null }),
          }),
        }),
      }),
    }),
  }),
}));

import { paymentService } from '../../src/services/payment.service';

describe('getUndisputedPayments enrollment scoping', () => {
  test('without enrollmentId returns all rows unchanged', async () => {
    const result = await paymentService.getUndisputedPayments('loc_1', 'c_1');
    expect(result.map((r: any) => r.id)).toEqual(['p1', 'p2', 'p3', 'p4']);
  });

  test('with enrollmentId puts same-enrollment payments first', async () => {
    const result = await paymentService.getUndisputedPayments('loc_1', 'c_1', 'enr_target');
    // same-enrollment (p2, p4) first, then other-enrollment (p1, p3)
    expect(result.map((r: any) => r.id)).toEqual(['p2', 'p4', 'p1', 'p3']);
  });

  test('no payments are dropped when scoping by enrollment', async () => {
    const result = await paymentService.getUndisputedPayments('loc_1', 'c_1', 'enr_target');
    expect(result).toHaveLength(4);
  });
});
