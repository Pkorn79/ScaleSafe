import { groupPaymentEventsByEnrollment } from '../../src/services/payment-enrollment-matching.service';

const repeatEnrollments = [
  {
    id: 'enr_first',
    offer_id: 'offer_shared',
    processor_subscription_id: 'sub_first',
    whop_membership_id: null,
  },
  {
    id: 'enr_second',
    offer_id: 'offer_shared',
    processor_subscription_id: null,
    whop_membership_id: 'mem_second',
  },
];

describe('groupPaymentEventsByEnrollment', () => {
  test('keeps exact enrollment payments isolated across repeat purchases', () => {
    const payments = [
      { id: 'pay_first', enrollment_id: 'enr_first', contact_id: 'contact_1', offer_id: 'offer_shared' },
      { id: 'pay_second', enrollment_id: 'enr_second', contact_id: 'contact_1', offer_id: 'offer_shared' },
    ];

    const grouped = groupPaymentEventsByEnrollment(repeatEnrollments, payments, 'contact_1');

    expect(grouped.get('enr_first')?.map(row => row.id)).toEqual(['pay_first']);
    expect(grouped.get('enr_second')?.map(row => row.id)).toEqual(['pay_second']);
  });

  test('uses a unique processor subscription or Whop membership when enrollment_id is absent', () => {
    const payments = [
      { id: 'pay_sub', enrollment_id: null, processor_subscription_id: 'sub_first', contact_id: 'contact_1', offer_id: 'offer_shared' },
      { id: 'pay_mem', enrollment_id: null, processor_subscription_id: 'mem_second', contact_id: 'contact_1', offer_id: 'offer_shared' },
    ];

    const grouped = groupPaymentEventsByEnrollment(repeatEnrollments, payments, 'contact_1');

    expect(grouped.get('enr_first')?.map(row => row.id)).toEqual(['pay_sub']);
    expect(grouped.get('enr_second')?.map(row => row.id)).toEqual(['pay_mem']);
  });

  test('does not fall through from an unknown subscription to same-contact offer matching', () => {
    const grouped = groupPaymentEventsByEnrollment(repeatEnrollments, [{
      id: 'pay_unknown_sub',
      enrollment_id: null,
      processor_subscription_id: 'sub_other',
      contact_id: 'contact_1',
      offer_id: 'offer_shared',
    }], 'contact_1');

    expect(grouped.get('enr_first')).toEqual([]);
    expect(grouped.get('enr_second')).toEqual([]);
  });

  test('does not guess between repeat enrollments for an unlinked legacy event', () => {
    const grouped = groupPaymentEventsByEnrollment(repeatEnrollments, [{
      id: 'pay_legacy',
      enrollment_id: null,
      processor_subscription_id: null,
      contact_id: 'contact_1',
      offer_id: 'offer_shared',
    }], 'contact_1');

    expect(grouped.get('enr_first')).toEqual([]);
    expect(grouped.get('enr_second')).toEqual([]);
  });

  test('keeps contact plus offer as a legacy fallback only when one enrollment qualifies', () => {
    const singleEnrollment = [{ id: 'enr_only', offer_id: 'offer_only' }];
    const grouped = groupPaymentEventsByEnrollment(singleEnrollment, [{
      id: 'pay_legacy',
      enrollment_id: null,
      processor_subscription_id: null,
      contact_id: 'contact_1',
      offer_id: 'offer_only',
    }], 'contact_1');

    expect(grouped.get('enr_only')?.map(row => row.id)).toEqual(['pay_legacy']);
  });

  test('rejects a contact mismatch from the legacy fallback', () => {
    const grouped = groupPaymentEventsByEnrollment(
      [{ id: 'enr_only', offer_id: 'offer_only' }],
      [{ id: 'pay_other', contact_id: 'contact_other', offer_id: 'offer_only' }],
      'contact_1',
    );

    expect(grouped.get('enr_only')).toEqual([]);
  });
});
