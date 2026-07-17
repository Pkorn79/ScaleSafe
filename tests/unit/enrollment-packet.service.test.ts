const mockGetEnrollment = jest.fn();
const mockFindOffer = jest.fn();
const mockGetMerchantConfig = jest.fn();
const mockRenderHtmlToPdf = jest.fn();
const mockFrom = jest.fn();

jest.mock('../../src/repositories/enrollment.repository', () => ({
  enrollmentRepository: { getById: (...args: unknown[]) => mockGetEnrollment(...args) },
}));

jest.mock('../../src/repositories/offer.repository', () => ({
  offerRepository: { findById: (...args: unknown[]) => mockFindOffer(...args) },
}));

jest.mock('../../src/services/merchant.service', () => ({
  merchantService: { getFullConfig: (...args: unknown[]) => mockGetMerchantConfig(...args) },
}));

jest.mock('../../src/services/pdf-renderer.service', () => ({
  renderHtmlToPdf: (...args: unknown[]) => mockRenderHtmlToPdf(...args),
}));

jest.mock('../../src/services/storage.service', () => ({
  storageService: {},
}));

jest.mock('../../src/clients/supabase.client', () => ({
  getSupabase: () => ({ from: mockFrom }),
}));

jest.mock('../../src/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import { enrollmentPacketService } from '../../src/services/enrollment-packet.service';

describe('enrollmentPacketService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetEnrollment.mockResolvedValue({
      id: 'enr_1',
      offer_id: 'offer_1',
      first_name: 'Client',
      last_name: 'Example',
      email: 'client@example.com',
      digital_signature: 'Client Example',
      clauses_accepted: ['purchase_summary'],
      payment_type: 'pif',
      payment_amount: 100,
    });
    mockFindOffer.mockResolvedValue({
      id: 'offer_1',
      offer_name: 'Client Program',
      price: 100,
      clause_slot_1_title: 'Purchase Summary (recommended)',
      clause_slot_1_text: 'I confirm that I am purchasing the program described for the total amount and payment terms shown above.',
      clause_slot_2_title: 'Cardholder Authorization (recommended)',
      clause_slot_2_text: 'I confirm that I am the authorized user of the payment method provided and I approve this transaction for the amount shown.',
    });
    mockGetMerchantConfig.mockResolvedValue({
      businessName: 'Legal Company LLC',
      dbaName: 'Client Brand',
      supportEmail: 'support@example.com',
      logoUrl: 'https://assets.example.com/logo.png',
    });
    mockFrom.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      order: jest.fn().mockResolvedValue({ data: [], error: null }),
    });
    mockRenderHtmlToPdf.mockResolvedValue(Buffer.from('pdf'));
  });

  test('uses client-facing DBA and accurately marks semantic clause acceptance', async () => {
    await enrollmentPacketService.generatePacket('enr_1', 'loc_1');

    const html = mockRenderHtmlToPdf.mock.calls[0][0] as string;
    expect(html).toContain('Client Brand');
    expect(html).toContain('Legal business: Legal Company LLC');
    expect(html).toMatch(/<td[^>]*>Yes<\/td>\s*<td[^>]*><strong>Purchase Summary/);
    expect(html).toMatch(/<td[^>]*>No<\/td>\s*<td[^>]*><strong>Cardholder Authorization/);
  });

  test('keeps legacy positional clause IDs readable', async () => {
    mockGetEnrollment.mockResolvedValue({
      id: 'enr_legacy',
      offer_id: 'offer_1',
      clauses_accepted: ['clause_2'],
      payment_type: 'pif',
      payment_amount: 100,
    });

    await enrollmentPacketService.generatePacket('enr_legacy', 'loc_1');

    const html = mockRenderHtmlToPdf.mock.calls[0][0] as string;
    expect(html).toMatch(/<td[^>]*>Yes<\/td>\s*<td[^>]*><strong>Cardholder Authorization/);
  });
});
