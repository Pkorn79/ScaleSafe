const mockUploadPublicAsset = jest.fn();
const mockUpdateFullConfig = jest.fn();

jest.mock('../../src/services/storage.service', () => ({
  storageService: {
    uploadPublicAsset: (...args: any[]) => mockUploadPublicAsset(...args),
  },
}));

jest.mock('../../src/services/merchant.service', () => ({
  merchantService: {
    updateFullConfig: (...args: any[]) => mockUpdateFullConfig(...args),
  },
}));

jest.mock('../../src/repositories/merchant.repository', () => ({
  merchantRepository: {},
}));

jest.mock('../../src/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import { merchantController } from '../../src/controllers/merchant.controller';

function res() {
  const response: any = {
    json: jest.fn(() => response),
    status: jest.fn(() => response),
  };
  return response;
}

describe('merchantController.uploadLogo', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUploadPublicAsset.mockResolvedValue('https://cdn.example/logo.png');
    mockUpdateFullConfig.mockResolvedValue({});
  });

  it('rejects SVG logo uploads', async () => {
    const req = {
      tenantContext: { locationId: 'loc_1' },
      params: {},
      file: {
        mimetype: 'image/svg+xml',
        originalname: 'logo.svg',
        buffer: Buffer.from('<svg></svg>'),
      },
    } as any;
    const response = res();
    const next = jest.fn();

    await merchantController.uploadLogo(req, response, next);

    expect(mockUploadPublicAsset).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expect.objectContaining({
      message: 'File must be PNG, JPEG, or WebP',
    }));
  });

  it('stores accepted logo types in the public assets bucket helper', async () => {
    const req = {
      tenantContext: { locationId: 'loc_1' },
      params: {},
      file: {
        mimetype: 'image/png',
        originalname: 'logo.svg',
        buffer: Buffer.from('png-data'),
      },
    } as any;
    const response = res();
    const next = jest.fn();

    await merchantController.uploadLogo(req, response, next);

    expect(next).not.toHaveBeenCalled();
    expect(mockUploadPublicAsset).toHaveBeenCalledWith(
      'logos/loc_1/logo.png',
      Buffer.from('png-data'),
      'image/png',
    );
    expect(mockUpdateFullConfig).toHaveBeenCalledWith('loc_1', {
      logoUrl: 'https://cdn.example/logo.png',
    });
    expect(response.json).toHaveBeenCalledWith({
      logoUrl: 'https://cdn.example/logo.png',
      storagePath: 'logos/loc_1/logo.png',
    });
  });
});
