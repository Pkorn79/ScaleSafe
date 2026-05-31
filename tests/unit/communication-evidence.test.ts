import { stripHtmlToText, cleanCommunicationBody } from '../../src/utils/communication-evidence';

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
