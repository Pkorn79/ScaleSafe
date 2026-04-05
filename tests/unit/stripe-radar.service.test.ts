/**
 * Stripe Radar Service tests — Phase S4
 *
 * Tests radar list initialization, card blocking, customer verification,
 * and graceful handling of missing lists.
 */

const mockCreate = jest.fn();
const mockItemCreate = jest.fn();
const mockItemList = jest.fn();

jest.mock('stripe', () => jest.fn(() => ({
  radar: {
    valueLists: {
      create: mockCreate,
    },
    valueListItems: {
      create: mockItemCreate,
      list: mockItemList,
    },
  },
})));

const mockFrom = jest.fn();
jest.mock('../../src/clients/supabase.client', () => ({
  getSupabase: () => ({ from: mockFrom }),
}));

jest.mock('../../src/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

import { StripeRadarService } from '../../src/services/stripe-radar.service';

describe('StripeRadarService', () => {
  let service: StripeRadarService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new StripeRadarService();
  });

  describe('initializeRadarLists', () => {
    it('creates both blocked cards and verified customers lists', async () => {
      // Mock: no existing lists
      mockFrom.mockReturnValueOnce({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            eq: jest.fn().mockResolvedValue({ data: [], error: null }),
          }),
        }),
      });

      mockCreate
        .mockResolvedValueOnce({ id: 'rsl_blocked_123' })
        .mockResolvedValueOnce({ id: 'rsl_verified_456' });

      // Mock insert
      mockFrom.mockReturnValueOnce({
        insert: jest.fn().mockResolvedValue({ error: null }),
      });

      await service.initializeRadarLists('merchant_1', 'loc_1', 'acct_123');

      expect(mockCreate).toHaveBeenCalledTimes(2);
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ alias: 'scalesafe_blocked_cards', item_type: 'card_fingerprint' }),
        { stripeAccount: 'acct_123' }
      );
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ alias: 'scalesafe_verified_customers', item_type: 'email' }),
        { stripeAccount: 'acct_123' }
      );
    });

    it('skips creation when lists already exist', async () => {
      // Mock: both lists exist
      mockFrom.mockReturnValueOnce({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            eq: jest.fn().mockResolvedValue({
              data: [
                { list_alias: 'scalesafe_blocked_cards' },
                { list_alias: 'scalesafe_verified_customers' },
              ],
              error: null,
            }),
          }),
        }),
      });

      await service.initializeRadarLists('merchant_1', 'loc_1', 'acct_123');

      expect(mockCreate).not.toHaveBeenCalled();
    });
  });

  describe('blockCard', () => {
    it('adds fingerprint to blocked list', async () => {
      mockFrom.mockReturnValueOnce({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                single: jest.fn().mockResolvedValue({
                  data: { stripe_value_list_id: 'rsl_blocked_123' },
                  error: null,
                }),
              }),
            }),
          }),
        }),
      });

      mockItemCreate.mockResolvedValue({ id: 'rsli_1' });

      await service.blockCard('merchant_1', 'loc_1', 'fp_abc123', 'acct_123');

      expect(mockItemCreate).toHaveBeenCalledWith(
        { value_list: 'rsl_blocked_123', value: 'fp_abc123' },
        { stripeAccount: 'acct_123' }
      );
    });

    it('handles missing list gracefully', async () => {
      mockFrom.mockReturnValueOnce({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                single: jest.fn().mockResolvedValue({
                  data: null,
                  error: null,
                }),
              }),
            }),
          }),
        }),
      });

      // Should not throw
      await service.blockCard('merchant_1', 'loc_1', 'fp_abc123', 'acct_123');

      expect(mockItemCreate).not.toHaveBeenCalled();
    });
  });

  describe('verifyCustomer', () => {
    it('adds email to verified list', async () => {
      mockFrom.mockReturnValueOnce({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                single: jest.fn().mockResolvedValue({
                  data: { stripe_value_list_id: 'rsl_verified_456' },
                  error: null,
                }),
              }),
            }),
          }),
        }),
      });

      mockItemCreate.mockResolvedValue({ id: 'rsli_2' });

      await service.verifyCustomer('merchant_1', 'loc_1', 'test@example.com', 'acct_123');

      expect(mockItemCreate).toHaveBeenCalledWith(
        { value_list: 'rsl_verified_456', value: 'test@example.com' },
        { stripeAccount: 'acct_123' }
      );
    });

    it('handles missing list gracefully', async () => {
      mockFrom.mockReturnValueOnce({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                single: jest.fn().mockResolvedValue({
                  data: null,
                  error: null,
                }),
              }),
            }),
          }),
        }),
      });

      await service.verifyCustomer('merchant_1', 'loc_1', 'test@example.com', 'acct_123');

      expect(mockItemCreate).not.toHaveBeenCalled();
    });
  });

  describe('get3dsPreference', () => {
    it('returns automatic for unverified customer over $1000', () => {
      expect(service.get3dsPreference(false, 150000)).toBe('automatic');
    });

    it('returns automatic for verified customer', () => {
      expect(service.get3dsPreference(true, 150000)).toBe('automatic');
    });

    it('returns automatic for small amount', () => {
      expect(service.get3dsPreference(false, 5000)).toBe('automatic');
    });
  });
});
