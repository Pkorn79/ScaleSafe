import { SS_CONTACT_FIELDS, OFFER_CONTACT_FIELDS, OFFER_CLAUSE_FIELDS, OFFER_MILESTONE_FIELDS, CUSTOM_TRIGGERS } from '../../src/constants/ghl-fields';

describe('GHL Fields Constants', () => {
  test('should have exactly 5 SS contact fields', () => {
    expect(Object.keys(SS_CONTACT_FIELDS).length).toBe(5);
  });

  test('SS fields should use contact. prefix', () => {
    for (const field of Object.values(SS_CONTACT_FIELDS)) {
      expect(field).toMatch(/^contact\.ss_/);
    }
  });

  test('should have 7 offer contact fields', () => {
    expect(Object.keys(OFFER_CONTACT_FIELDS).length).toBe(7);
  });

  test('should have 11 clause slots', () => {
    expect(OFFER_CLAUSE_FIELDS.length).toBe(11);
    for (const slot of OFFER_CLAUSE_FIELDS) {
      expect(slot.title).toMatch(/^contact\.offer_clause_slot_\d+_title$/);
      expect(slot.text).toMatch(/^contact\.offer_clause_slot_\d+_text$/);
    }
  });

  test('should have 8 milestone slots', () => {
    expect(OFFER_MILESTONE_FIELDS.length).toBe(8);
    for (const slot of OFFER_MILESTONE_FIELDS) {
      expect(slot.name).toMatch(/^contact\.offer_milestone_\d+_name$/);
      expect(slot.description).toMatch(/^contact\.offer_milestone_\d+_description$/);
    }
  });

  test('should have 5 custom triggers', () => {
    expect(Object.keys(CUSTOM_TRIGGERS).length).toBe(5);
    expect(CUSTOM_TRIGGERS.CHARGEBACK_DETECTED).toBe('Chargeback Detected');
    expect(CUSTOM_TRIGGERS.DEFENSE_READY).toBe('Defense Ready');
    expect(CUSTOM_TRIGGERS.EVIDENCE_MILESTONE).toBe('Evidence Milestone');
    expect(CUSTOM_TRIGGERS.CLIENT_AT_RISK).toBe('Client At Risk');
    expect(CUSTOM_TRIGGERS.PAYMENT_FAILED).toBe('Payment Failed');
  });
});
