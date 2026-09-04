const mockResolveSessionContext = jest.fn();
const mockTouchSession = jest.fn();
const mockWriteAudit = jest.fn();

jest.mock('../../src/repositories/operator.repository', () => ({
  isOperatorRole: (value: string) => [
    'platform_owner', 'platform_ops', 'platform_support', 'security_auditor',
    'reseller_owner', 'reseller_operator', 'reseller_viewer',
  ].includes(value),
  operatorRepository: {
    resolveSessionContext: (...args: any[]) => mockResolveSessionContext(...args),
    touchSession: (...args: any[]) => mockTouchSession(...args),
    writeAudit: (...args: any[]) => mockWriteAudit(...args),
  },
}));

jest.mock('../../src/utils/logger', () => ({
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

import { operatorAuthorizationService } from '../../src/services/operator-authorization.service';

const SESSION = {
  session_id: 'session-1',
  operator_user_id: 'user-1',
  organization_id: 'org-1',
  membership_id: 'membership-1',
  auth_assurance: 'aal2',
  csrf_token_hash: 'a'.repeat(64),
  last_seen_at: new Date().toISOString(),
  absolute_expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  user_id: 'user-1',
  user_status: 'active',
  membership_operator_user_id: 'user-1',
  membership_organization_id: 'org-1',
  membership_status: 'active',
  membership_role: 'platform_owner',
  organization_status: 'active',
  organization_type: 'platform',
  location_access_mode: 'all',
  location_ids: [],
};

function sessionContext(role: string, organizationType: 'platform' | 'reseller' = 'platform') {
  const locationAccessMode = role === 'platform_support'
    ? 'support_grants'
    : organizationType === 'reseller'
      ? 'assigned'
      : role === 'platform_owner' || role === 'platform_ops'
        ? 'all'
        : 'none';
  return {
    ...SESSION,
    membership_role: role,
    organization_type: organizationType,
    location_access_mode: locationAccessMode,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockResolveSessionContext.mockResolvedValue(sessionContext('platform_owner'));
  mockTouchSession.mockResolvedValue(undefined);
  mockWriteAudit.mockResolvedValue('audit-1');
});

describe('operator authorization live inputs', () => {
  it('gives a platform owner platform-wide location access', async () => {
    const result = await operatorAuthorizationService.resolveSessionToken('opaque-session');
    expect(result.context?.role).toBe('platform_owner');
    expect(result.context?.locationAccess.mode).toBe('all');
    expect(operatorAuthorizationService.canAccessLocation(result.context!, 'any-live-location')).toBe(true);
  });

  it('uses current reseller assignments on every request', async () => {
    mockResolveSessionContext.mockResolvedValueOnce({
      ...sessionContext('reseller_operator', 'reseller'),
      location_ids: ['loc-a'],
    });
    const first = await operatorAuthorizationService.resolveSessionToken('opaque-session');
    expect(operatorAuthorizationService.canAccessLocation(first.context!, 'loc-a')).toBe(true);
    expect(operatorAuthorizationService.canAccessLocation(first.context!, 'loc-b')).toBe(false);

    mockResolveSessionContext.mockResolvedValueOnce({
      ...sessionContext('reseller_operator', 'reseller'),
      location_ids: ['loc-b'],
    });
    const second = await operatorAuthorizationService.resolveSessionToken('opaque-session');
    expect(operatorAuthorizationService.canAccessLocation(second.context!, 'loc-a')).toBe(false);
    expect(operatorAuthorizationService.canAccessLocation(second.context!, 'loc-b')).toBe(true);
    expect(mockResolveSessionContext).toHaveBeenCalledTimes(2);
  });

  it('limits platform support to live support-grant locations', async () => {
    mockResolveSessionContext.mockResolvedValue({
      ...sessionContext('platform_support'),
      location_ids: ['loc-granted'],
    });
    const result = await operatorAuthorizationService.resolveSessionToken('opaque-session');
    expect(result.context?.locationAccess.mode).toBe('support_grants');
    expect(operatorAuthorizationService.canAccessLocation(result.context!, 'loc-granted')).toBe(true);
    expect(operatorAuthorizationService.canAccessLocation(result.context!, 'loc-other')).toBe(false);
  });

  it.each([
    ['disabled user', { ...sessionContext('platform_owner'), user_status: 'disabled' }],
    ['removed membership', { ...sessionContext('platform_owner'), membership_status: 'revoked' }],
    ['suspended organization', { ...sessionContext('platform_owner'), organization_status: 'suspended' }],
  ])('rejects a %s immediately', async (_label, currentIdentity) => {
    mockResolveSessionContext.mockResolvedValue(currentIdentity);
    const result = await operatorAuthorizationService.resolveSessionToken('opaque-session');
    expect(result.context).toBeNull();
    expect(result.denialReason).toBe('operator_identity_inactive');
    expect(result.actor?.operatorUserId).toBe('user-1');
  });

  it('rejects a revoked or expired opaque session immediately', async () => {
    mockResolveSessionContext.mockResolvedValue(null);
    const result = await operatorAuthorizationService.resolveSessionToken('revoked-session');
    expect(result).toEqual({ context: null, denialReason: 'session_missing_or_expired' });
    expect(mockResolveSessionContext).toHaveBeenCalledTimes(1);
  });

  it('loads session, identity, and live location grants in one repository call', async () => {
    await operatorAuthorizationService.resolveSessionToken('opaque-session');
    expect(mockResolveSessionContext).toHaveBeenCalledTimes(1);
  });
});
