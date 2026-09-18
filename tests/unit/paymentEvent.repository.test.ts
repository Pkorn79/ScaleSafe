import { paymentEventRepository } from '../../src/repositories/paymentEvent.repository';
import { getSupabase } from '../../src/clients/supabase.client';

jest.mock('../../src/clients/supabase.client', () => ({ getSupabase: jest.fn() }));

describe('payment event duplicate enrichment', () => {
  const sale = {
    location_id: 'matt', contact_id: 'verified_contact', customer_email: 'payer@example.com',
    event_type: 'sale', processor: 'nmi', processor_transaction_id: 'same_tx', amount: 0.05,
    processor_config_id: 'config_matt',
    source: 'quick_manual_sale', enrollment_id: null, offer_id: null,
  };
  afterEach(() => jest.restoreAllMocks());

  it('enriches a webhook-won insert race once without creating an enrollment or duplicating a payment', async () => {
    const sparse = { id: 'event_1', location_id: 'matt', contact_id: '', enrollment_id: null } as any;
    const lookup = jest.spyOn(paymentEventRepository, 'findByTransactionId')
      .mockResolvedValueOnce(null).mockResolvedValue(sparse);
    const insert = jest.spyOn(paymentEventRepository, 'create').mockRejectedValue({ code: '23505' });
    const chain: any = {
      update: jest.fn(() => chain), eq: jest.fn(() => chain), select: jest.fn(() => chain),
      single: jest.fn().mockResolvedValue({ data: { ...sparse, ...sale }, error: null }),
    };
    (getSupabase as jest.Mock).mockReturnValue({ from: jest.fn(() => chain) });
    const result = await paymentEventRepository.createOrReuseByTransaction(sale);
    expect(result.contact_id).toBe('verified_contact');
    expect(result.enrollment_id).toBeNull();
    expect(insert).toHaveBeenCalledTimes(1);
    expect(lookup).toHaveBeenCalledWith('nmi', 'same_tx', 'matt', 'config_matt');
    expect(chain.eq).toHaveBeenCalledWith('location_id', 'matt');
    expect(chain.update).toHaveBeenCalledWith(expect.objectContaining({ contact_id: 'verified_contact', customer_email: 'payer@example.com' }));
    expect(chain.update.mock.calls[0][0]).not.toHaveProperty('enrollment_id');
  });

  it('ignores blank duplicate metadata instead of erasing the existing client', async () => {
    const existing = { id: 'event_1', ...sale } as any;
    jest.spyOn(paymentEventRepository, 'findByTransactionId').mockResolvedValue(existing);
    const insert = jest.spyOn(paymentEventRepository, 'create');
    const from = jest.fn();
    (getSupabase as jest.Mock).mockReturnValue({ from });
    const result = await paymentEventRepository.createOrReuseByTransaction({
      location_id: 'matt', contact_id: '', event_type: 'sale', processor: 'nmi',
      processor_transaction_id: 'same_tx', amount: 0.05,
    });
    expect(result).toBe(existing);
    expect(insert).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
  });
});
