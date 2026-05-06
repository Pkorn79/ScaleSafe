import { VALID_TRIGGER_KEYS, isValidTriggerKey } from '../../src/constants/trigger-keys';

describe('Trigger Keys', () => {
  test('has 21 trigger keys', () => {
    expect(VALID_TRIGGER_KEYS).toHaveLength(21);
  });

  test('enrollment_complete is valid (no ss_ prefix)', () => {
    expect(isValidTriggerKey('enrollment_complete')).toBe(true);
  });

  test('ss_payment_received is valid', () => {
    expect(isValidTriggerKey('ss_payment_received')).toBe(true);
  });

  test('unknown key is invalid', () => {
    expect(isValidTriggerKey('bogus_trigger')).toBe(false);
  });

  test('all keys except enrollment_complete start with ss_', () => {
    const nonPrefixed = VALID_TRIGGER_KEYS.filter((k) => !k.startsWith('ss_'));
    expect(nonPrefixed).toEqual(['enrollment_complete']);
  });
});
