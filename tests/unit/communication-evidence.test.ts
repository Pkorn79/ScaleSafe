import { stripHtmlToText, cleanCommunicationBody, looksLikeUnrenderedTemplate } from '../../src/utils/communication-evidence';

describe('looksLikeUnrenderedTemplate', () => {
  // Live string from packet a2d357fa — a payment reminder whose merge fields
  // never rendered. These must be excluded from defense exhibits.
  const brokenReminder = 'Hi Philip, This is a reminder that your next payment for ScaleSafe Beta is coming up. '
    + 'Program: ScaleSafe Beta Amount: Next payment date: Payment number: of If you have questions, please contact . Thank you,';

  const welcomeEmail = 'Hi Philip, Welcome to ScaleSafe Beta with WholePay! We are excited to have you on board. '
    + 'Here is what you can expect: Your program: ScaleSafe Beta Payment type: Installment will be in touch shortly to schedule your first session.';

  const milestoneEmail = 'Hi Philip, Great news! WholePay has indicated that you have reached a milestone in ScaleSafe Beta. '
    + 'Current milestone: Merchant Setup Please take a moment to review what was delivered and confirm your completion.';

  const refundEmail = 'Hi Philip, This confirms that a refund has been processed for your account. '
    + 'Refund amount: $0.50 Refund date: 2026-06-03 Program: ScaleSafe Beta Please allow 5-10 business days.';

  test('detects the live broken payment reminder', () => {
    expect(looksLikeUnrenderedTemplate(brokenReminder)).toBe(true);
  });

  test('keeps real emails with rendered values', () => {
    expect(looksLikeUnrenderedTemplate(welcomeEmail)).toBe(false);
    expect(looksLikeUnrenderedTemplate(milestoneEmail)).toBe(false);
    expect(looksLikeUnrenderedTemplate(refundEmail)).toBe(false);
  });

  test('detects raw unrendered merge tags', () => {
    expect(looksLikeUnrenderedTemplate('Hi {{contact.first_name}}, your payment is due.')).toBe(true);
  });

  test('empty/non-string input is not flagged', () => {
    expect(looksLikeUnrenderedTemplate('')).toBe(false);
    expect(looksLikeUnrenderedTemplate(null)).toBe(false);
    expect(looksLikeUnrenderedTemplate(undefined)).toBe(false);
  });
});

describe('communication-evidence HTML entity decoding (#27)', () => {
  it('does not throw on out-of-range numeric entities (RangeError guard)', () => {
    expect(() => stripHtmlToText('hello &#9999999999; world')).not.toThrow();
    expect(() => stripHtmlToText('&#x110000;')).not.toThrow();
    expect(() => cleanCommunicationBody('spam &#2000000; body')).not.toThrow();
  });

  it('still decodes valid numeric and named entities', () => {
    expect(stripHtmlToText('a &#65; b')).toContain('A');
    expect(stripHtmlToText('x &amp; y')).toContain('&');
    expect(stripHtmlToText('&#x1F600;')).toBe('😀');
  });

  it('drops an out-of-range entity rather than crashing the whole body', () => {
    const out = stripHtmlToText('keep &#9999999999; this');
    expect(out).toContain('keep');
    expect(out).toContain('this');
  });
});
