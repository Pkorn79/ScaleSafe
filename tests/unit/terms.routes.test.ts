const mockFindByLocationId = jest.fn();
const mockGetFullConfig = jest.fn();

jest.mock('../../src/repositories/merchant.repository', () => ({
  merchantRepository: {
    findByLocationId: mockFindByLocationId,
  },
}));

jest.mock('../../src/services/merchant.service', () => ({
  merchantService: {
    getFullConfig: mockGetFullConfig,
  },
}));

jest.mock('../../src/utils/logger', () => ({
  logger: {
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

import express from 'express';
import request from 'supertest';
import termsRoutes from '../../src/routes/terms.routes';

const app = express();
app.use('/terms', termsRoutes);

describe('terms routes', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.NODE_ENV = 'test';
    mockFindByLocationId.mockResolvedValue({
      id: 'merchant_1',
      location_id: 'loc_1',
      business_name: 'Test Merchant',
    });
  });

  afterAll(() => {
    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }
  });

  it('redirects to a configured https terms URL', async () => {
    mockGetFullConfig.mockResolvedValue({
      tcHasOwn: true,
      tcDocumentUrl: ' https://merchant.example/terms ',
      businessName: 'Test Merchant',
    });

    const response = await request(app).get('/terms/loc_1');

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe('https://merchant.example/terms');
  });

  it('blocks javascript terms redirect URLs', async () => {
    mockGetFullConfig.mockResolvedValue({
      tcHasOwn: true,
      tcDocumentUrl: 'javascript:alert(1)',
      businessName: 'Test Merchant',
    });

    const response = await request(app).get('/terms/loc_1');

    expect(response.status).toBe(400);
    expect(response.text).toContain('not configured correctly');
  });

  it('blocks http terms redirect URLs in production', async () => {
    process.env.NODE_ENV = 'production';
    mockGetFullConfig.mockResolvedValue({
      tcHasOwn: true,
      tcDocumentUrl: 'http://merchant.example/terms',
      businessName: 'Test Merchant',
    });

    const response = await request(app).get('/terms/loc_1');

    expect(response.status).toBe(400);
    expect(response.text).toContain('not configured correctly');
  });

  it('allows http terms redirect URLs outside production', async () => {
    mockGetFullConfig.mockResolvedValue({
      tcHasOwn: true,
      tcDocumentUrl: 'http://localhost:4000/terms',
      businessName: 'Test Merchant',
    });

    const response = await request(app).get('/terms/loc_1');

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe('http://localhost:4000/terms');
  });

  it('sanitizes merchant HTML and serves it under a restrictive CSP', async () => {
    mockGetFullConfig.mockResolvedValue({
      tcHasOwn: false,
      tcCustomHtml: '<h2 onclick="steal()">Terms</h2><script>alert(1)</script><a href="javascript:alert(2)">Bad</a><a href="https://merchant.example/policy">Policy</a>',
      businessName: 'Test Merchant',
    });

    const response = await request(app).get('/terms/loc_1');

    expect(response.status).toBe(200);
    expect(response.text).toContain('<h2>Terms</h2>');
    expect(response.text).not.toContain('<script');
    expect(response.text).not.toContain('onclick=');
    expect(response.text).not.toContain('javascript:');
    expect(response.text).toContain('href="https://merchant.example/policy"');
    expect(response.text).toContain('rel="noopener noreferrer"');
    expect(response.headers['content-security-policy']).toContain("default-src 'none'");
  });
});
