import { evidenceConnectionManagementRoutes } from '../../src/routes/evidence-connector.routes';

describe('merchant evidence connection boundary', () => {
  it('exposes status and recent activity but no connector mutation controls', () => {
    const routes = (evidenceConnectionManagementRoutes as any).stack
      .filter((layer: any) => layer.route)
      .flatMap((layer: any) => Object.keys(layer.route.methods).map((method) => `${method.toUpperCase()} ${layer.route.path}`));

    expect(routes).toEqual(expect.arrayContaining(['GET /', 'GET /:id/events']));
    expect(routes).not.toEqual(expect.arrayContaining([
      'POST /',
      'GET /subjects',
      'PUT /:id',
      'POST /:id/rotate',
      'POST /:id/status',
      'POST /:id/preview',
      'POST /:id/test',
    ]));
  });
});
