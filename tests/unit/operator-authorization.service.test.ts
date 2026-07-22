const mockFindSession = jest.fn();
const mockFindLiveIdentity = jest.fn();
const mockListAssignments = jest.fn();
const mockListGrants = jest.fn();
const mockTouchSession = jest.fn();
const mockWriteAudit = jest.fn();

jest.mock('../../src/repositories/operator.repository', () => ({
  isOperatorRole: (value: string) => [
    'platform_owner', 'platform_ops', 'platform_support', 'security_auditor',
    'reseller_owner', 'reseller_operator', 'reseller_viewer',
  ].includes(value),
  operatorRepository: {
    findSession: (...args: any[]) => mockFindSession(...args),
    findLiveIdentityForSession: (...args: any[]) => mockFindLiveIdentity(...args),
    listActiveAssignmentLocations: (...args: any[]) => mockListAssignments(...args),
    listActiveSupportGrantLocations: (...args: any[]) => mockListGrants(...args),
    touchSession: (...args: any[]) => mockTouchSession(...args),
    writeAudit: (...args: any[]) => mockWriteAudit(...args),
  },
}));

jest.mock('../../src/utils/logger', () => ({
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

import { operatorAuthorizationService } from '../../src/services/operator-authorization.service';

const SESSION = {
  id: 'session-1',
  operator_user_id: 'user-1',
  organization_id: 'org-1',
  membership_id: 'membership-1',
  auth_assurance: 'aal2',
  csrf_token_hash: 'a'.repeat(64),
  last_seen_at: new Date().toISOString(),
  absolute_expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
};

function identity(role: string, organizationType: 'platform' | 'reseller' = 'platform') {
  return {
    user: { id: 'user-1', status: 'active' },
    membership: {
      id: 'membership-1',
      operator_user_id: 'user-1',
      organization_id: 'org-1',
      status: 'active',
      role,
    },
    organization: { id: 'org-1', status: 'active', organization_type: organizationType },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockFindSession.mockResolvedValue(SESSION);
  mockFindLiveIdentity.mockResolvedValue(identity('platform_owner'));
  mockListAssignments.mockResolvedValue([]);
  mockListGrants.mockResolvedValue([]);
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
    mockFindLiveIdentity.mockResolvedValue(identity('reseller_operator', 'reseller'));
    mockListAssignments.mockResolvedValueOnce(['loc-a']);
    const first = await operatorAuthorizationService.resolveSessionToken('opaque-session');
    expect(operatorAuthorizationService.canAccessLocation(first.context!, 'loc-a')).toBe(true);
    expect(operatorAuthorizationService.canAccessLocation(first.context!, 'loc-b')).toBe(false);

    mockListAssignments.mockResolvedValueOnce(['loc-b']);
    const second = await operatorAuthorizationService.resolveSessionToken('opaque-session');
    expect(operatorAuthorizationService.canAccessLocation(second.context!, 'loc-a')).toBe(false);
    expect(operatorAuthorizationService.canAccessLocation(second.context!, 'loc-b')).toBe(true);
    expect(mockListAssignments).toHaveBeenCalledTimes(2);
  });

  it('limits platform support to live support-grant locations', async () => {
    mockFindLiveIdentity.mockResolvedValue(identity('platform_support'));
    mockListGrants.mockResolvedValue(['loc-granted']);
    const result = await operatorAuthorizationService.resolveSessionToken('opaque-session');
    expect(result.context?.locationAccess.mode).toBe('support_grants');
    expect(operatorAuthorizationService.canAccessLocation(result.context!, 'loc-granted')).toBe(true);
    expect(operatorAuthorizationService.canAccessLocation(result.context!, 'loc-other')).toBe(false);
  });

  it.each([
    ['disabled user', { ...identity('platform_owner'), user: { id: 'user-1', status: 'disabled' } }],
    ['removed membership', { ...identity('platform_owner'), membership: { ...identity('platform_owner').membership, status: 'revoked' } }],
    ['suspended organization', { ...identity('platform_owner'), organization: { id: 'org-1', status: 'suspended', organization_type: 'platform' } }],
  ])('rejects a %s immediately', async (_label, currentIdentity) => {
    mockFindLiveIdentity.mockResolvedValue(currentIdentity);
    const result = await operatorAuthorizationService.resolveSessionToken('opaque-session');
    expect(result.context).toBeNull();
    expect(result.denialReason).toBe('operator_identity_inactive');
    expect(result.actor?.operatorUserId).toBe('user-1');
  });

  it('rejects a revoked or expired opaque session immediately', async () => {
    mockFindSession.mockResolvedValue(null);
    const result = await operatorAuthorizationService.resolveSessionToken('revoked-session');
    expect(result).toEqual({ context: null, denialReason: 'session_missing_or_expired' });
    expect(mockFindLiveIdentity).not.toHaveBeenCalled();
  });
});
