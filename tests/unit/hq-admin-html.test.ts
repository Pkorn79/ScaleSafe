jest.mock('../../src/config', () => ({
  config: { hqAdminToken: 'test-token', logLevel: 'silent', appUrl: 'http://localhost:3000' },
}));

import { hqHtml } from '../../src/routes/hq-admin.routes';

describe('ScaleSafe HQ operator console', () => {
  it('emits syntactically valid browser JavaScript and uses session-only token storage', () => {
    const html = hqHtml();
    const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1] || '';
    expect(script).toContain('openSetup');
    expect(script).toContain('sessionStorage');
    expect(script).not.toContain('localStorage');
    expect(() => new Function(script)).not.toThrow();
  });
});
