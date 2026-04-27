import {
  humanizeEventType,
  formatTimestamp,
  humanizeReasonCode,
  maskTransactionId,
  pluralize,
} from '../../src/ui/src/utils/humanize';

describe('humanizeEventType', () => {
  test('curated slug returns the curated label', () => {
    expect(humanizeEventType('send_enrollment_link')).toBe('Enrollment Link Sent');
    expect(humanizeEventType('evidence_milestone')).toBe('Milestone Logged');
    expect(humanizeEventType('pending_submission')).toBe('Pending Submission');
    expect(humanizeEventType('consent_captured')).toBe('Consent Captured');
    expect(humanizeEventType('payment_succeeded')).toBe('Payment Succeeded');
  });

  test('unknown slug falls back to title-case', () => {
    expect(humanizeEventType('foo_bar_baz')).toBe('Foo Bar Baz');
    expect(humanizeEventType('pulse_check')).toBe('Pulse Check');
    expect(humanizeEventType('SHOUTING_SLUG')).toBe('Shouting Slug');
  });

  test('empty / null / undefined → empty string', () => {
    expect(humanizeEventType('')).toBe('');
    expect(humanizeEventType(null)).toBe('');
    expect(humanizeEventType(undefined)).toBe('');
  });
});

describe('formatTimestamp', () => {
  const now = new Date('2026-04-26T12:00:00Z');

  test('relative — just now (<1 min)', () => {
    const ts = new Date(now.getTime() - 30_000); // 30s ago
    expect(formatTimestamp(ts, 'relative', now)).toBe('Just now');
  });

  test('relative — minutes ago', () => {
    const ts = new Date(now.getTime() - 5 * 60_000);
    expect(formatTimestamp(ts, 'relative', now)).toBe('5 minutes ago');
  });

  test('relative — singular minute', () => {
    const ts = new Date(now.getTime() - 60_000);
    expect(formatTimestamp(ts, 'relative', now)).toBe('1 minute ago');
  });

  test('relative — hours ago', () => {
    const ts = new Date(now.getTime() - 3 * 3_600_000);
    expect(formatTimestamp(ts, 'relative', now)).toBe('3 hours ago');
  });

  test('relative — yesterday', () => {
    const ts = new Date(now.getTime() - 1.5 * 86_400_000);
    expect(formatTimestamp(ts, 'relative', now)).toBe('Yesterday');
  });

  test('relative — days ago (within week)', () => {
    const ts = new Date(now.getTime() - 4 * 86_400_000);
    expect(formatTimestamp(ts, 'relative', now)).toBe('4 days ago');
  });

  test('relative — old date returns short date (current year)', () => {
    const ts = new Date('2026-01-15T10:00:00Z');
    const result = formatTimestamp(ts, 'relative', now);
    expect(result).toMatch(/Jan 1[45]/); // tolerant of TZ
  });

  test('relative — old date includes year if different', () => {
    const ts = new Date('2025-08-01T10:00:00Z');
    const result = formatTimestamp(ts, 'relative', now);
    expect(result).toMatch(/Aug 1, 2025/);
  });

  test('absolute — formatted with date and time', () => {
    const ts = new Date('2026-04-24T19:14:00Z');
    const result = formatTimestamp(ts, 'absolute', now);
    expect(result).toContain('Apr 24, 2026');
    expect(result).toContain('·');
  });

  test('short — month + day only', () => {
    const ts = new Date('2026-04-24T10:00:00Z');
    expect(formatTimestamp(ts, 'short', now)).toMatch(/Apr 2[34]/);
  });

  test('null / invalid / empty input → empty string', () => {
    expect(formatTimestamp(null)).toBe('');
    expect(formatTimestamp(undefined)).toBe('');
    expect(formatTimestamp('')).toBe('');
    expect(formatTimestamp('not-a-date')).toBe('');
  });

  test('accepts ISO string and Date instance equivalently', () => {
    const iso = '2026-04-26T11:55:00Z';
    const date = new Date(iso);
    expect(formatTimestamp(iso, 'relative', now)).toBe(formatTimestamp(date, 'relative', now));
  });
});

describe('humanizeReasonCode', () => {
  test('known Mastercard code', () => {
    expect(humanizeReasonCode('4855')).toBe('Goods/Services Not Provided');
    expect(humanizeReasonCode('4863')).toBe('Cardholder Does Not Recognize');
  });

  test('known Visa code', () => {
    expect(humanizeReasonCode('13.1')).toBe('Merchandise/Services Not Received');
    expect(humanizeReasonCode('10.4')).toBe('Other Fraud — Card Absent Environment');
  });

  test('known Amex code', () => {
    expect(humanizeReasonCode('F29')).toBe('Card Not Present');
    expect(humanizeReasonCode('C08')).toBe('Goods / Services Not Received');
  });

  test('unknown code returns input unchanged', () => {
    expect(humanizeReasonCode('9999')).toBe('9999');
  });

  test('whitespace trimmed before lookup', () => {
    expect(humanizeReasonCode('  4855  ')).toBe('Goods/Services Not Provided');
  });

  test('null / undefined / empty → empty string', () => {
    expect(humanizeReasonCode(null)).toBe('');
    expect(humanizeReasonCode(undefined)).toBe('');
    expect(humanizeReasonCode('')).toBe('');
  });
});

describe('maskTransactionId', () => {
  test('long ID gets first 4 + ellipsis + last 4', () => {
    expect(maskTransactionId('pi_3Q8aZxLkdIwHu7ix0aBcDeFg')).toBe('pi_3…DeFg');
    expect(maskTransactionId('txn_abcdef0123456789')).toBe('txn_…6789');
  });

  test('short ID returned unchanged', () => {
    expect(maskTransactionId('abc123')).toBe('abc123');
    expect(maskTransactionId('exactly11ch')).toBe('exactly11ch'); // 11 chars
  });

  test('boundary — exactly 12 chars gets masked', () => {
    expect(maskTransactionId('abcdefghijkl')).toBe('abcd…ijkl');
  });

  test('null / undefined / empty → empty string', () => {
    expect(maskTransactionId(null)).toBe('');
    expect(maskTransactionId(undefined)).toBe('');
    expect(maskTransactionId('')).toBe('');
  });

  test('whitespace trimmed', () => {
    expect(maskTransactionId('  pi_3Q8aZxLkdIwHu7ix0aBcDeFg  ')).toBe('pi_3…DeFg');
  });
});

describe('pluralize', () => {
  test('singular for 1 / -1', () => {
    expect(pluralize(1, 'day')).toBe('1 day');
    expect(pluralize(1, 'week')).toBe('1 week');
    expect(pluralize(-1, 'day')).toBe('-1 day');
  });

  test('plural for 0 (zero is plural in English)', () => {
    expect(pluralize(0, 'day')).toBe('0 days');
    expect(pluralize(0, 'week')).toBe('0 weeks');
  });

  test('plural for 2+', () => {
    expect(pluralize(2, 'day')).toBe('2 days');
    expect(pluralize(7, 'week')).toBe('7 weeks');
    expect(pluralize(12, 'month')).toBe('12 months');
  });

  test('strips trailing s on plural-looking unit before deciding', () => {
    expect(pluralize(1, 'days')).toBe('1 day');
    expect(pluralize(3, 'weeks')).toBe('3 weeks');
  });

  test('-y → -ies for consonant-preceded y', () => {
    expect(pluralize(2, 'story')).toBe('2 stories');
    expect(pluralize(1, 'story')).toBe('1 story');
  });

  test('-y stays -ys for vowel-preceded y', () => {
    expect(pluralize(2, 'day')).toBe('2 days');
    expect(pluralize(3, 'key')).toBe('3 keys');
  });

  test('irregular plurals', () => {
    expect(pluralize(2, 'child')).toBe('2 children');
    expect(pluralize(1, 'child')).toBe('1 child');
    expect(pluralize(5, 'person')).toBe('5 people');
  });

  test('null / undefined / empty count → empty string', () => {
    expect(pluralize(null, 'day')).toBe('');
    expect(pluralize(undefined, 'day')).toBe('');
    expect(pluralize('', 'day')).toBe('');
  });

  test('non-numeric count → empty string', () => {
    expect(pluralize('not-a-number', 'day')).toBe('');
  });

  test('numeric string count works', () => {
    expect(pluralize('1', 'day')).toBe('1 day');
    expect(pluralize('5', 'day')).toBe('5 days');
  });

  test('null / empty unit → just the count', () => {
    expect(pluralize(5, null)).toBe('5');
    expect(pluralize(5, '')).toBe('5');
    expect(pluralize(5, '   ')).toBe('5');
  });
});
