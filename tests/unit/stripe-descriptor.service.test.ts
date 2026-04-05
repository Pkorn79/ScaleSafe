/**
 * Stripe Descriptor Service tests — Phase S4
 *
 * Tests descriptor suffix formatting, prefix recommendation,
 * and special character handling.
 */

jest.mock('stripe', () => jest.fn(() => ({
  accounts: { retrieve: jest.fn() },
})));

jest.mock('../../src/clients/supabase.client', () => ({
  getSupabase: () => ({
    from: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({ data: null, error: null }),
          }),
        }),
      }),
    }),
  }),
}));

jest.mock('../../src/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

import { StripeDescriptorService } from '../../src/services/stripe-descriptor.service';

describe('StripeDescriptorService', () => {
  let service: StripeDescriptorService;

  beforeEach(() => {
    service = new StripeDescriptorService();
  });

  describe('formatDescriptorSuffix', () => {
    it('formats "12-Week Business Coaching" to "12-WEEK-BU"', () => {
      const result = service.formatDescriptorSuffix('12-Week Business Coaching');
      expect(result).toBe('12-WEEK-BU');
    });

    it('handles special characters by removing them', () => {
      const result = service.formatDescriptorSuffix('VIP!!! @Package #1');
      expect(result).toBe('VIP-PACKAG');
    });

    it('returns PROGRAM for empty string', () => {
      expect(service.formatDescriptorSuffix('')).toBe('PROGRAM');
    });

    it('returns PROGRAM for whitespace-only string', () => {
      expect(service.formatDescriptorSuffix('   ')).toBe('PROGRAM');
    });

    it('caps at 10 characters', () => {
      const result = service.formatDescriptorSuffix('Very Long Program Name That Exceeds Limit');
      expect(result.length).toBeLessThanOrEqual(10);
    });

    it('removes trailing hyphens', () => {
      // "Short Pro " would become "SHORT-PRO-" then trimmed to "SHORT-PRO"
      const result = service.formatDescriptorSuffix('Short Pro ');
      expect(result).not.toMatch(/-$/);
    });

    it('handles simple single word', () => {
      const result = service.formatDescriptorSuffix('Coaching');
      expect(result).toBe('COACHING');
    });

    it('uppercases the result', () => {
      const result = service.formatDescriptorSuffix('basic');
      expect(result).toBe('BASIC');
    });
  });

  describe('getFullDescriptor', () => {
    it('combines prefix and suffix with asterisk separator', () => {
      const result = service.getFullDescriptor('ACME COACH', 'VIP Package');
      expect(result).toBe('ACME COACH* VIP-PACKAG');
    });

    it('uses PROGRAM suffix when offer title is empty', () => {
      const result = service.getFullDescriptor('MYBIZ', '');
      expect(result).toBe('MYBIZ* PROGRAM');
    });
  });

  describe('recommendDescriptorPrefix', () => {
    it('strips LLC suffix', () => {
      const result = service.recommendDescriptorPrefix('Acme Coaching LLC');
      expect(result).toBe('ACME COACHIN');
    });

    it('strips Inc suffix', () => {
      const result = service.recommendDescriptorPrefix('Global Services Inc');
      expect(result).toBe('GLOBAL SERVI');
    });

    it('strips Corp suffix', () => {
      const result = service.recommendDescriptorPrefix('Big Corp');
      expect(result).toBe('BIG');
    });

    it('removes special characters and collapses spaces', () => {
      const result = service.recommendDescriptorPrefix("O'Brien & Associates");
      // After removing ' and &, there are double spaces
      expect(result.length).toBeLessThanOrEqual(12);
      expect(result).toMatch(/^[A-Z0-9\s]+$/);
    });

    it('caps at 12 characters', () => {
      const result = service.recommendDescriptorPrefix('Very Long Business Name Here');
      expect(result.length).toBeLessThanOrEqual(12);
    });

    it('returns empty for empty input', () => {
      expect(service.recommendDescriptorPrefix('')).toBe('');
    });

    it('handles whitespace-only input', () => {
      expect(service.recommendDescriptorPrefix('   ')).toBe('');
    });
  });
});
