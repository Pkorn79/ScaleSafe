import { dashboardController } from '../../src/controllers/dashboard.controller';
import { getSupabase } from '../../src/clients/supabase.client';
import { ghlApi } from '../../src/clients/ghl.client';
jest.mock('../../src/clients/supabase.client', () => ({ getSupabase: jest.fn() }));
jest.mock('../../src/clients/ghl.client', () => ({ ghlApi: jest.fn() }));

function query(data: any, count = 0) {
  const chain: any = {};
  for (const method of ['select', 'eq', 'in', 'not', 'or', 'order', 'range', 'limit']) chain[method] = jest.fn(() => chain);
  chain.single = chain.maybeSingle = jest.fn().mockResolvedValue({ data, error: null });
  chain.then = (resolve: any, reject: any) => Promise.resolve({ data, error: null, count }).then(resolve, reject);
  return chain;
}

test('client list includes a payment-only contact with no program queries', async () => {
  const list = query([{ contact_id: 'client', enrollment_id: null, offer_id: null, email: 'payer@example.com', first_name: 'Test', status: 'active', payment_type: 'manual_sale' }], 1);
  const from = jest.fn(() => list);
  (getSupabase as jest.Mock).mockReturnValue({ from });
  const res: any = { json: jest.fn() };
  const next = jest.fn();
  await dashboardController.clients({ params: { locationId: 'matt' }, query: { statusGroup: 'active', search: 'payer' } } as any, res, next);
  expect(next).not.toHaveBeenCalled();
  expect(from).toHaveBeenCalledTimes(1);
  expect(list.eq).toHaveBeenCalledWith('location_id', 'matt');
  expect(list.in.mock.calls[0][1]).toContain('active');
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ clients: [expect.objectContaining({ contactId: 'client', canOpenProfile: true, enrollmentId: null, offerName: '' })] }));
});

test('standalone profile includes payments and refunds even when GHL is unavailable', async () => {
  const payments = query([
    { event_type: 'sale', amount: 5, created_at: '2026-09-18', customer_email: 'payer@example.com', raw_webhook_payload: { first_name: 'Test', last_name: 'Payer' } },
    { event_type: 'refund', amount: 1, created_at: '2026-09-18' },
  ]);
  (getSupabase as jest.Mock).mockReturnValue({ from: jest.fn((table: string) => table === 'payment_events' ? payments : query(table === 'enrollments' ? [] : null)) });
  (ghlApi as jest.Mock).mockRejectedValue(new Error('unavailable'));
  const res: any = { json: jest.fn() };
  const next = jest.fn();
  await dashboardController.clientInfo({ params: { locationId: 'matt', contactId: 'client' } } as any, res, next);
  expect(next).not.toHaveBeenCalled();
  expect(payments.eq).toHaveBeenCalledWith('location_id', 'matt');
  expect(payments.eq).toHaveBeenCalledWith('contact_id', 'client');
  expect(payments.not).not.toHaveBeenCalled();
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ name: 'Test Payer', email: 'payer@example.com', enrollmentId: null, offerName: '', totalCharged: 5, totalRefunded: 1 }));
});
