export {};

const originalEnvironment = { ...process.env };

jest.mock('../../src/routes', () => ({
  __esModule: true,
  default: require('express').Router(),
}));

describe('application proxy configuration', () => {
  afterEach(() => {
    process.env = { ...originalEnvironment };
    jest.resetModules();
  });

  it('uses the explicit application proxy depth even while Command Center is disabled', () => {
    process.env.APP_TRUST_PROXY_HOPS = '2';
    process.env.OPERATOR_COMMAND_CENTER_ENABLED = 'false';
    jest.resetModules();

    const { createApp } = require('../../src/app');
    const app = createApp();

    expect(app.get('trust proxy')).toBe(2);
  });
});
