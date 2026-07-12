const mockBuildExhibits = jest.fn();
const mockGenerateLetter = jest.fn();
const mockRenderHtml = jest.fn();
const mockDownload = jest.fn();
const mockUpload = jest.fn();
const mockSupabaseFrom = jest.fn();

function queryBuilder(result: any = null) {
  const builder: any = {
    select: jest.fn(() => builder),
    update: jest.fn(() => builder),
    eq: jest.fn(() => builder),
    order: jest.fn(() => builder),
    limit: jest.fn(() => builder),
    maybeSingle: jest.fn().mockResolvedValue({ data: result, error: null }),
  };
  return builder;
}

jest.mock('../../src/repositories/defense.repository', () => ({
  defenseRepository: {
    getById: jest.fn().mockResolvedValue({
      id: 'def_1', location_id: 'loc_1', contact_id: 'c_1',
      defense_letter_text: 'Letter', chargeback_reason_code: '13.1',
      chargeback_amount: 500, chargeback_date: '2026-07-01', case_number: 'case_1',
      enrollment_id: 'enr_1', offer_id: 'offer_1',
    }),
    getReasonCodeStrategy: jest.fn().mockResolvedValue(null),
  },
}));

jest.mock('../../src/repositories/merchant.repository', () => ({
  merchantRepository: { getByLocationId: jest.fn().mockResolvedValue({ business_name: 'Merchant' }) },
}));

jest.mock('../../src/services/defense-exhibits.service', () => {
  const actual = jest.requireActual('../../src/services/defense-exhibits.service');
  return {
    ...actual,
    defenseExhibitsService: { buildExhibitList: (...args: any[]) => mockBuildExhibits(...args) },
  };
});

jest.mock('../../src/services/defense-letter-pdf.service', () => ({
  defenseLetterPdfService: { generateLetterPdf: (...args: any[]) => mockGenerateLetter(...args) },
}));

jest.mock('../../src/services/pdf-renderer.service', () => ({
  renderHtmlToPdf: (...args: any[]) => mockRenderHtml(...args),
}));

jest.mock('../../src/services/storage.service', () => ({
  storageService: {
    downloadPrivateFileWithLegacy: (...args: any[]) => mockDownload(...args),
    uploadPrivateFile: (...args: any[]) => mockUpload(...args),
  },
}));

jest.mock('../../src/clients/ghl.client', () => ({
  ghlApi: jest.fn().mockRejectedValue(new Error('not needed')),
}));

jest.mock('../../src/clients/supabase.client', () => ({
  getSupabase: () => ({ from: (...args: any[]) => mockSupabaseFrom(...args) }),
}));

import { PDFDocument } from 'pdf-lib';
import { defenseBundleService } from '../../src/services/defense-bundle.service';

async function validPdf(): Promise<Buffer> {
  const document = await PDFDocument.create();
  document.addPage();
  return Buffer.from(await document.save());
}

beforeEach(async () => {
  jest.clearAllMocks();
  mockSupabaseFrom.mockImplementation((table: string) => {
    if (table === 'defense_letter_versions') {
      return queryBuilder({ version_number: 2, letter_text: 'Locked letter version two' });
    }
    if (table === 'defense_packets') return queryBuilder({ id: 'def_1' });
    return queryBuilder(null);
  });
  mockUpload.mockResolvedValue('https://signed.test/defense.pdf');
  mockGenerateLetter.mockResolvedValue(await validPdf());
  mockRenderHtml.mockResolvedValue(await validPdf());
  mockBuildExhibits.mockResolvedValue({
    exhibits: [], byCategory: {}, totals: {}, sourceErrors: [], enrollmentPacketPath: null,
  });
});

test('fails closed when the signed enrollment packet cannot be loaded', async () => {
  mockBuildExhibits.mockResolvedValue({
    exhibits: [{ letter: 'A', name: 'Signed Enrollment Packet', category: 'consent', occurredAt: '2026-07-01', summary: 'Signed' }],
    byCategory: {}, totals: {}, sourceErrors: [], enrollmentPacketPath: 'enrollment-packets/loc_1/enr_1.pdf',
  });
  mockDownload.mockRejectedValue(new Error('storage object missing'));

  await expect(defenseBundleService.bundleDefensePdf('def_1', 'loc_1', 'c_1', { enrollmentId: 'enr_1' }))
    .rejects.toThrow(/Required signed enrollment packet could not be loaded/i);
});

test('fails closed when the required defense letter PDF is malformed', async () => {
  mockGenerateLetter.mockResolvedValue(Buffer.from('not a pdf'));

  await expect(defenseBundleService.bundleDefensePdf('def_1', 'loc_1', 'c_1', { enrollmentId: 'enr_1' }))
    .rejects.toThrow(/required defense PDF section could not be merged \(defense letter\)/i);
});

test('renders and versions the PDF from the locked letter row instead of the packet mirror', async () => {
  await defenseBundleService.bundleDefensePdf('def_1', 'loc_1', 'c_1', { enrollmentId: 'enr_1' });

  expect(mockGenerateLetter).toHaveBeenCalledWith(expect.objectContaining({
    letterText: 'Locked letter version two',
  }));
  expect(mockUpload).toHaveBeenCalledWith(
    'defense-packets/loc_1/def_1-v2.pdf',
    expect.any(Buffer),
    'application/pdf',
  );
});
