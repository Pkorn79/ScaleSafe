let tableData: Record<string, any> = {};
const mockGhlGet = jest.fn();

function builder(table: string) {
  const query: any = {};
  query.select = jest.fn(() => query);
  query.eq = jest.fn(() => query);
  query.maybeSingle = jest.fn(async () => ({ data: tableData[table] ?? null, error: null }));
  return query;
}

jest.mock('../../src/clients/supabase.client', () => ({
  getSupabase: () => ({ from: (table: string) => builder(table) }),
}));

jest.mock('../../src/clients/ghl.client', () => ({
  ghlApi: jest.fn(async () => ({ get: (...args: any[]) => mockGhlGet(...args) })),
}));

import { defenseInputValidationService } from '../../src/services/defense-input-validation.service';

describe('defenseInputValidationService', () => {
  beforeEach(() => {
    tableData = {};
    jest.clearAllMocks();
    mockGhlGet.mockResolvedValue({ data: { contact: { id: 'contact-1' } } });
  });

  it('derives enrollment and offer from the tenant-scoped disputed payment', async () => {
    tableData.payment_events = {
      id: 'payment-1', contact_id: 'contact-1', enrollment_id: 'enrollment-1', offer_id: 'offer-1',
      processor: 'stripe', created_at: '2026-07-14T03:51:30Z',
    };
    tableData.enrollments = { id: 'enrollment-1', offer_id: 'offer-1' };
    tableData.offers_mirror = { id: 'offer-1' };

    await expect(defenseInputValidationService.validate({
      locationId: 'loc-1', contactId: 'contact-1', paymentEventId: 'payment-1',
    })).resolves.toEqual(expect.objectContaining({
      paymentEventId: 'payment-1',
      enrollmentId: 'enrollment-1',
      offerId: 'offer-1',
      processor: 'stripe',
    }));
    expect(mockGhlGet).not.toHaveBeenCalled();
  });

  it('rejects an enrollment that cannot be verified for the authenticated tenant and client', async () => {
    await expect(defenseInputValidationService.validate({
      locationId: 'loc-1', contactId: 'contact-1', enrollmentId: 'enrollment-other-tenant',
    })).rejects.toThrow('Enrollment does not belong to this client and sub-account');
    expect(mockGhlGet).not.toHaveBeenCalled();
  });

  it('rejects caller-supplied enrollment data that conflicts with the payment event', async () => {
    tableData.payment_events = {
      id: 'payment-1', contact_id: 'contact-1', enrollment_id: 'enrollment-1', offer_id: 'offer-1',
    };

    await expect(defenseInputValidationService.validate({
      locationId: 'loc-1',
      contactId: 'contact-1',
      paymentEventId: 'payment-1',
      enrollmentId: 'enrollment-2',
    })).rejects.toThrow('Selected enrollment does not match the disputed transaction');
  });

  it('derives the payment rail and rejects a conflicting caller-supplied processor', async () => {
    tableData.payment_events = {
      id: 'payment-1', contact_id: 'contact-1', processor: 'stripe', created_at: '2026-07-14T03:51:30Z',
    };

    await expect(defenseInputValidationService.validate({
      locationId: 'loc-1', contactId: 'contact-1', paymentEventId: 'payment-1', processor: 'nmi',
    })).rejects.toThrow('Selected processor does not match the disputed transaction');
  });

  it('compares transaction and dispute dates in the supplied IANA timezone', async () => {
    tableData.payment_events = {
      id: 'payment-1', contact_id: 'contact-1', processor: 'stripe', created_at: '2026-07-14T03:51:30Z',
    };

    await expect(defenseInputValidationService.validate({
      locationId: 'loc-1', contactId: 'contact-1', paymentEventId: 'payment-1',
      disputeDate: '2026-07-13', disputeTimezone: 'America/Chicago',
    })).resolves.toEqual(expect.objectContaining({ processor: 'stripe' }));

    await expect(defenseInputValidationService.validate({
      locationId: 'loc-1', contactId: 'contact-1', paymentEventId: 'payment-1',
      disputeDate: '2026-07-12', disputeTimezone: 'America/Chicago',
    })).rejects.toThrow('Dispute date cannot be before the selected transaction date (2026-07-13)');
  });

  it('verifies a manual contact-only defense through the tenant-scoped GHL API', async () => {
    await expect(defenseInputValidationService.validate({
      locationId: 'loc-1', contactId: 'contact-1',
    })).resolves.toEqual({ locationId: 'loc-1', contactId: 'contact-1' });
    expect(mockGhlGet).toHaveBeenCalledWith('/contacts/contact-1');
  });

  it('rejects a manual contact that GHL cannot resolve inside the tenant', async () => {
    mockGhlGet.mockRejectedValue(new Error('not found'));

    await expect(defenseInputValidationService.validate({
      locationId: 'loc-1', contactId: 'contact-other',
    })).rejects.toThrow('Client does not belong to this sub-account');
  });
});
