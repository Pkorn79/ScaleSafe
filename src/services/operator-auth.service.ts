import { getSupabase } from '../clients/supabase.client';
import { createOperatorAuthClient } from '../clients/operator-auth.client';
import { config } from '../config';
import { operatorRepository } from '../repositories/operator.repository';
import { operatorAuthorizationService } from './operator-authorization.service';
import { AppError, AuthenticationError, ServiceUnavailableError, ValidationError } from '../utils/errors';
import {
  decryptOperatorCredential,
  encryptOperatorCredential,
  hashOperatorValue,
  normalizeOperatorEmail,
  operatorIpHash,
  operatorUserAgent,
  randomOperatorToken,
} from '../utils/operator-security';
import { Request } from 'express';
import { logger } from '../utils/logger';

interface PendingAuthResult {
  pendingToken: string;
  next: 'mfa_enroll' | 'mfa_verify';
  expiresInSeconds: number;
}

function genericAuthenticationError(): AuthenticationError {
  return new AuthenticationError('Invalid email, password, or operator access');
}

function validPassword(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 12 && value.length <= 128;
}

async function auditAuth(req: Request, input: {
  actorOperatorUserId?: string;
  actorOrganizationId?: string;
  actorRole?: any;
  action: string;
  result: 'intent' | 'allowed' | 'denied' | 'succeeded' | 'failed';
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await operatorAuthorizationService.auditRequest(req, input);
}

async function enforceLoginRateLimits(req: Request, email: string): Promise<void> {
  const [accountAllowed, ipAllowed] = await Promise.all([
    operatorRepository.consumeRateLimit('login_account', hashOperatorValue(email), 5, 15 * 60),
    operatorRepository.consumeRateLimit('login_ip', operatorIpHash(req), 20, 15 * 60),
  ]);
  if (!accountAllowed || !ipAllowed) {
    throw new AppError('Too many authentication attempts', 429, 'RATE_LIMITED');
  }
}

async function enforceInvitationRateLimits(req: Request, invitationToken: string): Promise<void> {
  const [tokenAllowed, ipAllowed] = await Promise.all([
    operatorRepository.consumeRateLimit('invite_token', hashOperatorValue(invitationToken), 6, 30 * 60),
    operatorRepository.consumeRateLimit('invite_ip', operatorIpHash(req), 20, 30 * 60),
  ]);
  if (!tokenAllowed || !ipAllowed) {
    throw new AppError('Too many invitation attempts', 429, 'RATE_LIMITED');
  }
}

async function restoreAttemptAuthSession(attempt: any) {
  const client = createOperatorAuthClient();
  const { data, error } = await client.auth.setSession({
    access_token: decryptOperatorCredential(attempt.access_token_encrypted),
    refresh_token: decryptOperatorCredential(attempt.refresh_token_encrypted),
  });
  if (error || !data.session || data.user?.id !== attempt.auth_user_id) {
    throw new AuthenticationError('Operator authentication attempt expired');
  }
  return { client, session: data.session };
}

async function removeUnclaimedTotpFactor(
  client: ReturnType<typeof createOperatorAuthClient>,
  factorId: string,
): Promise<void> {
  try {
    const { error } = await client.auth.mfa.unenroll({ factorId });
    if (error) logger.warn({ err: error }, 'Could not remove unclaimed operator MFA factor');
  } catch (err) {
    logger.warn({ err }, 'Could not remove unclaimed operator MFA factor');
  }
}

export const operatorAuthService = {
  async startPasswordAuthentication(req: Request, emailInput: unknown, passwordInput: unknown): Promise<PendingAuthResult> {
    const email = normalizeOperatorEmail(emailInput);
    const password = typeof passwordInput === 'string' ? passwordInput : '';
    if (!email || !password || !email.includes('@')) throw genericAuthenticationError();

    await enforceLoginRateLimits(req, email);
    const client = createOperatorAuthClient();
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (error || !data.session || !data.user) {
      try {
        await auditAuth(req, {
          action: 'operator.auth.password',
          result: 'denied',
          metadata: { reason: 'credential_rejected', email_hash: hashOperatorValue(email) },
        });
      } catch (auditError) {
        logger.error({ err: auditError }, 'Operator password denial audit failed');
        throw new ServiceUnavailableError('Operator audit service unavailable');
      }
      throw genericAuthenticationError();
    }

    const identity = await operatorRepository.findIdentityByAuthUserId(data.user.id);
    const role = identity?.membership?.role;
    const activeIdentity = Boolean(
      identity?.user?.status === 'active'
      && identity.user.email_normalized === email
      && identity?.membership?.status === 'active'
      && identity?.organization?.status === 'active'
      && data.user.email_confirmed_at,
    );
    if (!activeIdentity) {
      try {
        await auditAuth(req, {
          actorOperatorUserId: identity?.user?.id,
          actorOrganizationId: identity?.organization?.id,
          actorRole: role,
          action: 'operator.auth.password',
          result: 'denied',
          metadata: { reason: 'operator_identity_inactive' },
        });
      } catch (auditError) {
        logger.error({ err: auditError }, 'Inactive operator denial audit failed');
        throw new ServiceUnavailableError('Operator audit service unavailable');
      }
      throw genericAuthenticationError();
    }

    await auditAuth(req, {
      actorOperatorUserId: identity!.user.id,
      actorOrganizationId: identity!.organization.id,
      actorRole: role,
      action: 'operator.auth.attempt.create',
      result: 'intent',
      targetType: 'operator_user',
      targetId: identity!.user.id,
    });

    const verifiedFactors = (data.user.factors || []).filter((factor: any) => (
      factor.factor_type === 'totp' && factor.status === 'verified'
    ));
    const state = verifiedFactors.length > 0 ? 'mfa_required' : 'mfa_enrollment';
    const pendingToken = randomOperatorToken('opauth');
    const expiresAt = new Date(Date.now() + config.operator.authAttemptMinutes * 60 * 1000);
    await operatorRepository.createAuthAttempt({
      attempt_token_hash: hashOperatorValue(pendingToken),
      operator_user_id: identity!.user.id,
      auth_user_id: data.user.id,
      email_normalized: email,
      access_token_encrypted: encryptOperatorCredential(data.session.access_token),
      refresh_token_encrypted: encryptOperatorCredential(data.session.refresh_token),
      mfa_factor_id: verifiedFactors[0]?.id || null,
      state,
      expires_at: expiresAt.toISOString(),
      ip_address_hash: operatorIpHash(req),
      user_agent: operatorUserAgent(req),
    });

    return {
      pendingToken,
      next: state === 'mfa_required' ? 'mfa_verify' : 'mfa_enroll',
      expiresInSeconds: config.operator.authAttemptMinutes * 60,
    };
  },

  async enrollTotp(req: Request, pendingToken: string): Promise<{
    factorId: string;
    qrCode: string;
    secret: string;
    uri: string;
  }> {
    const attempt = await operatorRepository.findAuthAttempt(hashOperatorValue(pendingToken));
    if (!attempt || attempt.state !== 'mfa_enrollment') throw new AuthenticationError('Operator authentication attempt expired');
    await auditAuth(req, {
      actorOperatorUserId: attempt.operator_user_id,
      action: 'operator.auth.mfa.enroll',
      result: 'intent',
      targetType: 'operator_user',
      targetId: attempt.operator_user_id,
    });
    const { client } = await restoreAttemptAuthSession(attempt);
    const { data, error } = await client.auth.mfa.enroll({
      factorType: 'totp',
      friendlyName: 'ScaleSafe Command Center',
      issuer: 'ScaleSafe',
    });
    if (error || !data || data.type !== 'totp') {
      await operatorRepository.incrementAuthAttemptFailure(attempt.id);
      throw new ServiceUnavailableError('Could not enroll the authenticator factor');
    }
    let factorPersisted = false;
    try {
      factorPersisted = await operatorRepository.setAuthAttemptFactor(attempt.id, data.id);
    } catch (err) {
      await removeUnclaimedTotpFactor(client, data.id);
      throw err;
    }
    if (!factorPersisted) {
      await removeUnclaimedTotpFactor(client, data.id);
      throw new AuthenticationError('Operator authentication attempt expired');
    }
    await auditAuth(req, {
      actorOperatorUserId: attempt.operator_user_id,
      action: 'operator.auth.mfa.enroll',
      result: 'succeeded',
      targetType: 'operator_user',
      targetId: attempt.operator_user_id,
    });
    return {
      factorId: data.id,
      qrCode: data.totp.qr_code,
      secret: data.totp.secret,
      uri: data.totp.uri,
    };
  },

  async verifyTotp(req: Request, pendingToken: string, codeInput: unknown): Promise<{
    sessionToken: string;
    csrfToken: string;
    maxAgeSeconds: number;
  }> {
    const code = String(codeInput || '').replace(/\s/g, '');
    if (!/^\d{6}$/.test(code)) throw new ValidationError('Enter the six-digit authenticator code');
    const attemptTokenHash = hashOperatorValue(pendingToken);
    const attempt = await operatorRepository.findAuthAttempt(attemptTokenHash);
    if (!attempt || attempt.state !== 'mfa_required' || !attempt.mfa_factor_id) {
      throw new AuthenticationError('Operator authentication attempt expired');
    }

    await auditAuth(req, {
      actorOperatorUserId: attempt.operator_user_id,
      action: 'operator.auth.session.create',
      result: 'intent',
      targetType: 'operator_user',
      targetId: attempt.operator_user_id,
    });

    const { client } = await restoreAttemptAuthSession(attempt);
    const { data, error } = await client.auth.mfa.challengeAndVerify({
      factorId: attempt.mfa_factor_id,
      code,
    });
    if (error || !data?.access_token || !data?.refresh_token) {
      await operatorRepository.incrementAuthAttemptFailure(attempt.id);
      try {
        await auditAuth(req, {
          actorOperatorUserId: attempt.operator_user_id,
          action: 'operator.auth.mfa.verify',
          result: 'denied',
          targetType: 'operator_user',
          targetId: attempt.operator_user_id,
          metadata: { reason: 'mfa_rejected' },
        });
      } catch (auditError) {
        logger.error({ err: auditError }, 'Operator MFA denial audit failed');
      }
      throw genericAuthenticationError();
    }

    const { data: assurance, error: assuranceError } = await client.auth.mfa
      .getAuthenticatorAssuranceLevel(data.access_token);
    if (assuranceError || assurance?.currentLevel !== 'aal2') {
      await operatorRepository.incrementAuthAttemptFailure(attempt.id);
      throw new AuthenticationError('Multi-factor authentication was not completed');
    }

    const sessionToken = randomOperatorToken('opsession');
    const csrfToken = randomOperatorToken('opcsrf');
    const now = Date.now();
    const absoluteExpiry = now + config.operator.sessionAbsoluteMinutes * 60 * 1000;
    const idleExpiry = Math.min(
      now + config.operator.sessionIdleMinutes * 60 * 1000,
      absoluteExpiry,
    );
    await operatorRepository.completeAuthAttempt({
      attemptTokenHash,
      sessionTokenHash: hashOperatorValue(sessionToken),
      csrfTokenHash: hashOperatorValue(csrfToken),
      idleExpiresAt: new Date(idleExpiry).toISOString(),
      absoluteExpiresAt: new Date(absoluteExpiry).toISOString(),
      ipAddressHash: operatorIpHash(req),
      userAgent: operatorUserAgent(req),
    });

    return {
      sessionToken,
      csrfToken,
      maxAgeSeconds: config.operator.sessionAbsoluteMinutes * 60,
    };
  },

  async acceptInvitation(req: Request, input: {
    invitationToken: unknown;
    email: unknown;
    password: unknown;
    displayName: unknown;
  }): Promise<void> {
    const invitationToken = String(input.invitationToken || '');
    const email = normalizeOperatorEmail(input.email);
    const displayName = String(input.displayName || '').trim().slice(0, 200);
    if (invitationToken.length < 20 || invitationToken.length > 1000 || !email.includes('@') || !displayName || !validPassword(input.password)) {
      throw new ValidationError('Invitation, email, display name, and a password of at least 12 characters are required');
    }

    await enforceInvitationRateLimits(req, invitationToken);
    const tokenHash = hashOperatorValue(invitationToken);
    await auditAuth(req, {
      action: 'operator.invitation.accept',
      result: 'intent',
      targetType: 'operator_invitation',
      metadata: { invitation_hash_prefix: tokenHash.slice(0, 12) },
    });

    const invitation = await operatorRepository.claimInvitation(tokenHash, email);
    if (!invitation) {
      await auditAuth(req, {
        action: 'operator.invitation.accept',
        result: 'denied',
        targetType: 'operator_invitation',
        metadata: { reason: 'invalid_or_expired' },
      });
      throw new AuthenticationError('Invitation is invalid, expired, or already used');
    }

    const verificationClient = createOperatorAuthClient();
    const { data: verification, error: verificationError } = await verificationClient.auth.verifyOtp({
      token_hash: invitationToken,
      type: 'invite',
    });
    if (verificationError || !verification.user || verification.user.id !== invitation.auth_user_id
      || normalizeOperatorEmail(verification.user.email) !== email) {
      await operatorRepository.releaseInvitation(invitation.id, 'Supabase Auth invitation verification failed');
      await auditAuth(req, {
        action: 'operator.invitation.accept',
        result: 'failed',
        targetType: 'operator_invitation',
        targetId: invitation.id,
        metadata: { error_class: 'auth_verification_failed' },
      });
      throw new AuthenticationError('Invitation is invalid, expired, or already used');
    }

    const { data, error } = await getSupabase().auth.admin.updateUserById(verification.user.id, {
      password: input.password,
      user_metadata: { display_name: displayName },
    });
    if (error || !data.user || normalizeOperatorEmail(data.user.email) !== email) {
      await auditAuth(req, {
        action: 'operator.invitation.accept',
        result: 'failed',
        targetType: 'operator_invitation',
        targetId: invitation.id,
        metadata: { error_class: 'password_activation_failed' },
      });
      throw new ServiceUnavailableError('Invitation requires operator support to finish');
    }

    try {
      await operatorRepository.completeInvitation({
        invitationId: invitation.id,
        authUserId: data.user.id,
        email,
        displayName,
      });
    } catch (err) {
      logger.error({ err, invitationId: invitation.id }, 'Operator invitation database completion failed');
      throw new ServiceUnavailableError('Invitation requires operator support to finish');
    }
  },
};
