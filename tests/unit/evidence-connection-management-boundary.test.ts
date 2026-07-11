import { evidenceConnectionManagementRoutes } from '../../src/routes/evidence-connector.routes';

describe('merchant evidence connection boundary', () => {
  it('exposes the catalog and tenant-safe connection controls without advanced mapper controls', () => {
    const routes = (evidenceConnectionManagementRoutes as any).stack
      .filter((layer: any) => layer.route)
      .flatMap((layer: any) => Object.keys(layer.route.methods).map((method) => `${method.toUpperCase()} ${layer.route.path}`));

    expect(routes).toEqual(expect.arrayContaining([
      'GET /',
      'GET /catalog',
      'GET /offer-options',
      'POST /catalog/:providerKey/connect',
      'POST /:id/status',
      'GET /:id/events',
    ]));
    expect(routes).not.toEqual(expect.arrayContaining([
      'POST /',
      'GET /subjects',
      'PUT /:id',
      'POST /:id/rotate',
      'POST /:id/preview',
      'POST /:id/test',
    ]));
  });
});
