import { Request } from 'express';

const mockSignInWithPassword = jest.fn();
const mockSetSession = jest.fn();
const mockEnroll = jest.fn();
const mockChallengeAndVerify = jest.fn();
const mockGetAal = jest.fn();
const mockVerifyOtp = jest.fn();
const mockUnenroll = jest.fn();
const mockUpdateUserById = jest.fn();

const mockRepository = {
  consumeRateLimit: jest.fn(),
  findIdentityByAuthUserId: jest.fn(),
  createAuthAttempt: jest.fn(),
  findAuthAttempt: jest.fn(),
  incrementAuthAttemptFailure: jest.fn(),
  setAuthAttemptFactor: jest.fn(),
  completeAuthAttempt: jest.fn(),
  claimInvitation: jest.fn(),
  releaseInvitation: jest.fn(),
  completeInvitation: jest.fn(),
};
const mockAuditRequest = jest.fn();

jest.mock('../../src/clients/operator-auth.client', () => ({
  createOperatorAuthClient: () => ({
    auth: {
      signInWithPassword: (...args: any[]) => mockSignInWithPassword(...args),
      setSession: (...args: any[]) => mockSetSession(...args),
      verifyOtp: (...args: any[]) => mockVerifyOtp(...args),
      mfa: {
        enroll: (...args: any[]) => mockEnroll(...args),
        unenroll: (...args: any[]) => mockUnenroll(...args),
        challengeAndVerify: (...args: any[]) => mockChallengeAndVerify(...args),
        getAuthenticatorAssuranceLevel: (...args: any[]) => mockGetAal(...args),
      },
    },
  }),
}));

jest.mock('../../src/clients/supabase.client', () => ({
  getSupabase: () => ({
    auth: { admin: { updateUserById: (...args: any[]) => mockUpdateUserById(...args) } },
  }),
}));

jest.mock('../../src/repositories/operator.repository', () => ({
  operatorRepository: mockRepository,
}));

jest.mock('../../src/services/operator-authorization.service', () => ({
  operatorAuthorizationService: {
    auditRequest: (...args: any[]) => mockAuditRequest(...args),
  },
}));

jest.mock('../../src/utils/logger', () => ({
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

import { operatorAuthService } from '../../src/services/operator-auth.service';
import { decryptOperatorCredential, encryptOperatorCredential } from '../../src/utils/operator-security';

const requestStub = {
  ip: '203.0.113.10',
  socket: { remoteAddress: '203.0.113.10' },
  headers: { 'user-agent': 'operator-test' },
  operatorRequestId: 'request-1',
} as unknown as Request;

const identity = {
  user: { id: 'operator-1', status: 'active', email_normalized: 'owner@example.com' },
  membership: { id: 'membership-1', status: 'active', role: 'platform_owner' },
  organization: { id: 'org-1', status: 'active' },
};

function signedInUser(factors: any[] = [{ id: 'factor-1', factor_type: 'totp', status: 'verified' }]) {
  const user = {
    id: 'auth-1',
    email: 'owner@example.com',
    email_confirmed_at: '2026-01-01T00:00:00Z',
    factors,
  };
  return {
    data: {
      user,
      session: { access_token: 'supabase-access', refresh_token: 'supabase-refresh', user },
    },
    error: null,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockRepository.consumeRateLimit.mockResolvedValue(true);
  mockRepository.findIdentityByAuthUserId.mockResolvedValue(identity);
  mockRepository.createAuthAttempt.mockResolvedValue({ id: 'attempt-1' });
  mockRepository.incrementAuthAttemptFailure.mockResolvedValue(undefined);
  mockRepository.setAuthAttemptFactor.mockResolvedValue(true);
  mockRepository.completeAuthAttempt.mockResolvedValue({ id: 'session-1' });
  mockRepository.releaseInvitation.mockResolvedValue(undefined);
  mockRepository.completeInvitation.mockResolvedValue({ id: 'operator-2' });
  mockAuditRequest.mockResolvedValue('audit-1');
  mockSignInWithPassword.mockResolvedValue(signedInUser());
  mockVerifyOtp.mockResolvedValue({
    data: {
      user: { id: 'auth-2', email: 'invitee@example.com' },
      session: { access_token: 'server-only', refresh_token: 'server-only' },
    },
    error: null,
  });
});

describe('operator auth service', () => {
  it('keeps Supabase tokens server-side and creates only a pending opaque browser token', async () => {
    const result = await operatorAuthService.startPasswordAuthentication(
      requestStub,
      'OWNER@EXAMPLE.COM',
      'correct-horse-battery-staple',
    );

    expect(result.next).toBe('mfa_verify');
    expect(result.pendingToken).toMatch(/^opauth_/);
    expect(result).not.toHaveProperty('access_token');
    expect(result).not.toHaveProperty('refresh_token');
    const insert = mockRepository.createAuthAttempt.mock.calls[0][0];
    expect(insert.attempt_token_hash).not.toContain(result.pendingToken);
    expect(insert.access_token_encrypted).not.toBe('supabase-access');
    expect(decryptOperatorCredential(insert.access_token_encrypted)).toBe('supabase-access');
    expect(decryptOperatorCredential(insert.refresh_token_encrypted)).toBe('supabase-refresh');
  });

  it('requires TOTP enrollment when no verified factor exists', async () => {
    mockSignInWithPassword.mockResolvedValue(signedInUser([]));
    const result = await operatorAuthService.startPasswordAuthentication(
      requestStub,
      'owner@example.com',
      'correct-horse-battery-staple',
    );
    expect(result.next).toBe('mfa_enroll');
    expect(mockRepository.createAuthAttempt).toHaveBeenCalledWith(expect.objectContaining({
      state: 'mfa_enrollment',
      mfa_factor_id: null,
    }));
  });

  it('blocks auth-attempt creation when its durable audit intent fails', async () => {
    mockAuditRequest.mockRejectedValueOnce(new Error('audit unavailable'));
    await expect(operatorAuthService.startPasswordAuthentication(
      requestStub,
      'owner@example.com',
      'correct-horse-battery-staple',
    )).rejects.toThrow('audit unavailable');
    expect(mockRepository.createAuthAttempt).not.toHaveBeenCalled();
  });

  it('does not disclose whether rejected credentials belong to an operator', async () => {
    mockSignInWithPassword.mockResolvedValue({ data: { user: null, session: null }, error: new Error('bad password') });
    await expect(operatorAuthService.startPasswordAuthentication(
      requestStub,
      'unknown@example.com',
      'wrong-password',
    )).rejects.toMatchObject({ statusCode: 401, message: 'Invalid email, password, or operator access' });
    expect(mockAuditRequest).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      result: 'denied',
      metadata: expect.objectContaining({ reason: 'credential_rejected' }),
    }));
  });

  it('enrolls TOTP only after a durable audit intent', async () => {
    mockRepository.findAuthAttempt.mockResolvedValue({
      id: 'attempt-1',
      state: 'mfa_enrollment',
      operator_user_id: 'operator-1',
      auth_user_id: 'auth-1',
      access_token_encrypted: encryptOperatorCredential('access'),
      refresh_token_encrypted: encryptOperatorCredential('refresh'),
    });
    mockSetSession.mockResolvedValue({
      data: { user: { id: 'auth-1' }, session: { access_token: 'access', refresh_token: 'refresh' } },
      error: null,
    });
    mockEnroll.mockResolvedValue({
      data: { id: 'factor-new', type: 'totp', totp: { qr_code: '<svg/>', secret: 'SECRET', uri: 'otpauth://example' } },
      error: null,
    });

    const result = await operatorAuthService.enrollTotp(requestStub, 'pending-token');
    expect(result).toEqual({ factorId: 'factor-new', qrCode: '<svg/>', secret: 'SECRET', uri: 'otpauth://example' });
    expect(mockAuditRequest.mock.invocationCallOrder[0]).toBeLessThan(mockEnroll.mock.invocationCallOrder[0]);
    expect(mockRepository.setAuthAttemptFactor).toHaveBeenCalledWith('attempt-1', 'factor-new');
  });

  it('never returns an MFA secret when another request already claimed the attempt', async () => {
    mockRepository.findAuthAttempt.mockResolvedValue({
      id: 'attempt-1',
      state: 'mfa_enrollment',
      operator_user_id: 'operator-1',
      auth_user_id: 'auth-1',
      access_token_encrypted: encryptOperatorCredential('access'),
      refresh_token_encrypted: encryptOperatorCredential('refresh'),
    });
    mockSetSession.mockResolvedValue({
      data: { user: { id: 'auth-1' }, session: { access_token: 'access', refresh_token: 'refresh' } },
      error: null,
    });
    mockEnroll.mockResolvedValue({
      data: { id: 'factor-lost-race', type: 'totp', totp: { qr_code: '<svg/>', secret: 'SECRET', uri: 'otpauth://example' } },
      error: null,
    });
    mockRepository.setAuthAttemptFactor.mockResolvedValue(false);
    mockUnenroll.mockResolvedValue({ data: {}, error: null });

    await expect(operatorAuthService.enrollTotp(requestStub, 'pending-token')).rejects.toMatchObject({ statusCode: 401 });
    expect(mockUnenroll).toHaveBeenCalledWith({ factorId: 'factor-lost-race' });
  });

  it('creates an app-owned session only after Supabase confirms AAL2', async () => {
    mockRepository.findAuthAttempt.mockResolvedValue({
      id: 'attempt-1',
      state: 'mfa_required',
      operator_user_id: 'operator-1',
      auth_user_id: 'auth-1',
      mfa_factor_id: 'factor-1',
      access_token_encrypted: encryptOperatorCredential('access'),
      refresh_token_encrypted: encryptOperatorCredential('refresh'),
    });
    mockSetSession.mockResolvedValue({
      data: { user: { id: 'auth-1' }, session: { access_token: 'access', refresh_token: 'refresh' } },
      error: null,
    });
    mockChallengeAndVerify.mockResolvedValue({
      data: { access_token: 'aal2-access', refresh_token: 'aal2-refresh' },
      error: null,
    });
    mockGetAal.mockResolvedValue({ data: { currentLevel: 'aal2', nextLevel: 'aal2' }, error: null });

    const result = await operatorAuthService.verifyTotp(requestStub, 'pending-token', '123456');
    expect(result.sessionToken).toMatch(/^opsession_/);
    expect(result.csrfToken).toMatch(/^opcsrf_/);
    expect(mockRepository.completeAuthAttempt).toHaveBeenCalledWith(expect.objectContaining({
      sessionTokenHash: expect.stringMatching(/^[0-9a-f]{64}$/),
      csrfTokenHash: expect.stringMatching(/^[0-9a-f]{64}$/),
    }));
    expect(mockRepository.completeAuthAttempt.mock.calls[0][0]).not.toHaveProperty('accessToken');
  });

  it('rejects MFA verification that does not reach AAL2', async () => {
    mockRepository.findAuthAttempt.mockResolvedValue({
      id: 'attempt-1', state: 'mfa_required', operator_user_id: 'operator-1', auth_user_id: 'auth-1', mfa_factor_id: 'factor-1',
      access_token_encrypted: encryptOperatorCredential('access'), refresh_token_encrypted: encryptOperatorCredential('refresh'),
    });
    mockSetSession.mockResolvedValue({ data: { user: { id: 'auth-1' }, session: { access_token: 'access', refresh_token: 'refresh' } }, error: null });
    mockChallengeAndVerify.mockResolvedValue({ data: { access_token: 'aal1-access', refresh_token: 'refresh' }, error: null });
    mockGetAal.mockResolvedValue({ data: { currentLevel: 'aal1', nextLevel: 'aal2' }, error: null });

    await expect(operatorAuthService.verifyTotp(requestStub, 'pending-token', '123456')).rejects.toMatchObject({ statusCode: 401 });
    expect(mockRepository.completeAuthAttempt).not.toHaveBeenCalled();
    expect(mockRepository.incrementAuthAttemptFailure).toHaveBeenCalledWith('attempt-1');
  });

  it('accepts a single-use invitation only for its exact confirmed email identity', async () => {
    const invitationToken = `supabase-invite-${'a'.repeat(43)}`;
    mockRepository.claimInvitation.mockResolvedValue({ id: 'invite-1', auth_user_id: 'auth-2' });
    mockUpdateUserById.mockResolvedValue({
      data: { user: { id: 'auth-2', email: 'invitee@example.com' } },
      error: null,
    });
    await operatorAuthService.acceptInvitation(requestStub, {
      invitationToken,
      email: 'Invitee@Example.com',
      displayName: 'Invitee',
      password: 'a-strong-password-123',
    });
    expect(mockVerifyOtp).toHaveBeenCalledWith({ token_hash: invitationToken, type: 'invite' });
    expect(mockUpdateUserById).toHaveBeenCalledWith('auth-2', expect.objectContaining({
      password: 'a-strong-password-123',
    }));
    expect(mockUpdateUserById.mock.calls[0][1]).not.toHaveProperty('email_confirm');
    expect(mockRepository.completeInvitation).toHaveBeenCalledWith({
      invitationId: 'invite-1',
      authUserId: 'auth-2',
      email: 'invitee@example.com',
      displayName: 'Invitee',
    });
  });

  it('releases the invitation when Supabase verifies a mismatched email', async () => {
    mockRepository.claimInvitation.mockResolvedValue({ id: 'invite-1', auth_user_id: 'auth-2' });
    mockVerifyOtp.mockResolvedValue({
      data: { user: { id: 'auth-2', email: 'wrong@example.com' }, session: null },
      error: null,
    });
    await expect(operatorAuthService.acceptInvitation(requestStub, {
      invitationToken: `supabase-invite-${'a'.repeat(43)}`,
      email: 'invitee@example.com',
      displayName: 'Invitee',
      password: 'a-strong-password-123',
    })).rejects.toMatchObject({ statusCode: 401 });
    expect(mockRepository.releaseInvitation).toHaveBeenCalledWith('invite-1', expect.any(String));
    expect(mockUpdateUserById).not.toHaveBeenCalled();
    expect(mockRepository.completeInvitation).not.toHaveBeenCalled();
  });
});
