/**
 * Reason-code registry tests: network/category resolution and per-network
 * response windows. An unknown code must resolve to null (never guessed).
 */

import { resolveReasonCode, responseWindowDays, NETWORK_RESPONSE_DAYS } from '../../src/constants/reason-codes';

describe('resolveReasonCode', () => {
  test('resolves Visa consumer-dispute family', () => {
    expect(resolveReasonCode('13.1')?.category).toBe('services_not_provided');
    expect(resolveReasonCode('13.2')?.category).toBe('canceled_recurring');
    expect(resolveReasonCode('13.5')?.category).toBe('misrepresentation');
    expect(resolveReasonCode('13.7')?.category).toBe('canceled_services');
    expect(resolveReasonCode('13.2')?.network).toBe('visa');
  });

  test('resolves Mastercard codes including 4841', () => {
    expect(resolveReasonCode('4837')?.category).toBe('fraud');
    expect(resolveReasonCode('4841')?.category).toBe('canceled_recurring');
    expect(resolveReasonCode('4834')?.category).toBe('duplicate_processing');
    expect(resolveReasonCode('4841')?.network).toBe('mastercard');
  });

  test('resolves Amex codes case-insensitively', () => {
    expect(resolveReasonCode('C28')?.category).toBe('canceled_recurring');
    expect(resolveReasonCode('c28')?.category).toBe('canceled_recurring');
    expect(resolveReasonCode('F29')?.category).toBe('fraud');
    expect(resolveReasonCode('C08')?.network).toBe('amex');
  });

  test('resolves Discover codes', () => {
    expect(resolveReasonCode('RG')?.category).toBe('services_not_provided');
    expect(resolveReasonCode('AP')?.category).toBe('canceled_recurring');
    expect(resolveReasonCode('AA')?.network).toBe('discover');
  });

  test('unknown codes return null — never a guessed category', () => {
    expect(resolveReasonCode('99.99')).toBeNull();
    expect(resolveReasonCode('')).toBeNull();
    expect(resolveReasonCode('BOGUS')).toBeNull();
  });
});

describe('responseWindowDays', () => {
  test('per-network windows: Visa 30, MC 45, Amex 20, Discover 20', () => {
    expect(responseWindowDays('13.1')).toBe(30);
    expect(responseWindowDays('4837')).toBe(45);
    expect(responseWindowDays('C08')).toBe(20);
    expect(responseWindowDays('RG')).toBe(20);
    expect(responseWindowDays('nope')).toBeNull();
  });

  test('Amex window is never longer than 20 days (default-loss guard)', () => {
    expect(NETWORK_RESPONSE_DAYS.amex).toBeLessThanOrEqual(20);
  });
});
