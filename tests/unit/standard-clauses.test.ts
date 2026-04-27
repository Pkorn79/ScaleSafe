import { STANDARD_CLAUSES } from '../../src/constants/standard-clauses';

describe('STANDARD_CLAUSES', () => {
  test('has exactly 9 entries', () => {
    expect(STANDARD_CLAUSES).toHaveLength(9);
  });

  test('every clause has the required fields', () => {
    for (const clause of STANDARD_CLAUSES) {
      expect(typeof clause.key).toBe('string');
      expect(clause.key.length).toBeGreaterThan(0);
      expect(typeof clause.label).toBe('string');
      expect(typeof clause.text).toBe('string');
      expect(clause.text.length).toBeGreaterThan(0);
      expect(typeof clause.recommended).toBe('boolean');
      expect(typeof clause.ghlFieldId).toBe('string');
      expect(typeof clause.ghlFieldKey).toBe('string');
    }
  });

  test('every ghlFieldKey matches the clickwrap fieldKey pattern', () => {
    const pattern = /^contact\.clickwrap_[a-z_]+$/;
    for (const clause of STANDARD_CLAUSES) {
      expect(clause.ghlFieldKey).toMatch(pattern);
    }
  });

  test('every ghlFieldId is a 20-character GHL ID', () => {
    const pattern = /^[A-Za-z0-9]{20}$/;
    for (const clause of STANDARD_CLAUSES) {
      expect(clause.ghlFieldId).toMatch(pattern);
    }
  });

  test('clause keys are unique', () => {
    const keys = STANDARD_CLAUSES.map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  test('ghlFieldKey values are unique', () => {
    const keys = STANDARD_CLAUSES.map((c) => c.ghlFieldKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  test('ghlFieldId values are unique', () => {
    const ids = STANDARD_CLAUSES.map((c) => c.ghlFieldId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('clause keys map to expected fieldKeys (regression guard)', () => {
    const expected: Record<string, string> = {
      purchase_summary: 'contact.clickwrap_purchase_summary',
      cardholder_auth: 'contact.clickwrap_cardholder_authorization',
      program_scope: 'contact.clickwrap_program_scope',
      refund_cancellation: 'contact.clickwrap_refund__cancellation',
      digital_access: 'contact.clickwrap_digital_access_acknowledgment',
      participation_responsibility: 'contact.clickwrap_participation_responsibility',
      no_guaranteed_results: 'contact.clickwrap_no_guaranteed_results',
      installment_billing: 'contact.clickwrap_installment_billing',
      feedback_checkin: 'contact.clickwrap_feedback__checkin',
    };
    for (const clause of STANDARD_CLAUSES) {
      expect(expected[clause.key]).toBe(clause.ghlFieldKey);
    }
  });
});
