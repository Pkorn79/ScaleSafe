import {
  createPublicActionToken,
  legacyPublicActionLinksAllowed,
  verifyPublicActionToken,
} from '../../src/utils/public-action-token';

describe('public action tokens', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalLegacy = process.env.ALLOW_LEGACY_PUBLIC_ACTION_LINKS;

  beforeEach(() => {
    process.env.PUBLIC_ACTION_TOKEN_SECRET = 'unit-test-public-action-secret';
    delete process.env.ALLOW_LEGACY_PUBLIC_ACTION_LINKS;
    process.env.NODE_ENV = 'test';
  });

  afterEach(() => {
    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }
    if (originalLegacy === undefined) {
      delete process.env.ALLOW_LEGACY_PUBLIC_ACTION_LINKS;
    } else {
      process.env.ALLOW_LEGACY_PUBLIC_ACTION_LINKS = originalLegacy;
    }
    delete process.env.PUBLIC_ACTION_TOKEN_SECRET;
  });

  it('round-trips signed action context', () => {
    const token = createPublicActionToken({
      action: 'milestone_signoff',
      locationId: 'loc_123',
      contactId: 'contact_456',
      enrollmentId: 'enr_789',
      milestoneNumber: 2,
    });

    expect(verifyPublicActionToken(token, 'milestone_signoff')).toMatchObject({
      action: 'milestone_signoff',
      locationId: 'loc_123',
      contactId: 'contact_456',
      enrollmentId: 'enr_789',
      milestoneNumber: 2,
    });
  });

  it('rejects a token for the wrong action', () => {
    const token = createPublicActionToken({
      action: 'payment_update',
      locationId: 'loc_123',
      contactId: 'contact_456',
    });

    expect(() => verifyPublicActionToken(token, 'subscription_cancel')).toThrow('Action token cannot be used');
  });

  it('rejects tampered tokens', () => {
    const token = createPublicActionToken({
      action: 'payment_update',
      locationId: 'loc_123',
      contactId: 'contact_456',
    });
    const [payload, signature] = token.split('.');
    const tamperedPayload = Buffer.from(JSON.stringify({
      action: 'payment_update',
      locationId: 'loc_other',
      contactId: 'contact_456',
      exp: Math.floor(Date.now() / 1000) + 60,
    })).toString('base64url');

    expect(() => verifyPublicActionToken(`${tamperedPayload}.${signature}`)).toThrow('Invalid action token');
    expect(payload).toBeTruthy();
  });

  it('rejects expired tokens', () => {
    const token = createPublicActionToken({
      action: 'payment_update',
      locationId: 'loc_123',
      contactId: 'contact_456',
      ttlSeconds: -1,
    });

    expect(() => verifyPublicActionToken(token)).toThrow('expired');
  });

  it('allows legacy raw links outside production only unless explicitly enabled', () => {
    process.env.NODE_ENV = 'production';
    expect(legacyPublicActionLinksAllowed()).toBe(false);

    process.env.ALLOW_LEGACY_PUBLIC_ACTION_LINKS = 'true';
    expect(legacyPublicActionLinksAllowed()).toBe(true);
  });
});
