import { EVIDENCE_TYPES, EVIDENCE_TABLE_MAP, EXTERNAL_EVENT_MAP, GHL_FORM_MAP } from '../../src/constants/evidence-types';

describe('Evidence Types', () => {
  test('should have 21 evidence types', () => {
    const types = Object.values(EVIDENCE_TYPES);
    expect(types.length).toBe(21);
  });

  test('every evidence type should have a table mapping', () => {
    for (const type of Object.values(EVIDENCE_TYPES)) {
      expect(EVIDENCE_TABLE_MAP[type]).toBeDefined();
      expect(EVIDENCE_TABLE_MAP[type]).toMatch(/^evidence_/);
    }
  });

  test('all external event types should map to valid evidence types', () => {
    const validTypes = new Set(Object.values(EVIDENCE_TYPES));
    for (const [eventType, evidenceType] of Object.entries(EXTERNAL_EVENT_MAP)) {
      expect(validTypes.has(evidenceType)).toBe(true);
    }
  });

  test('all GHL form IDs should map to valid evidence types', () => {
    const validTypes = new Set(Object.values(EVIDENCE_TYPES));
    expect(Object.keys(GHL_FORM_MAP)).toEqual(
      expect.arrayContaining(['SYS2-07', 'SYS2-08', 'SYS2-09', 'SYS2-10', 'SYS2-11']),
    );
    for (const evidenceType of Object.values(GHL_FORM_MAP)) {
      expect(validTypes.has(evidenceType)).toBe(true);
    }
  });
});
