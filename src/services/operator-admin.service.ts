import crypto from 'crypto';
import { Request } from 'express';
import { getSupabase } from '../clients/supabase.client';
import { config } from '../config';
import { operatorRepository, isOperatorRole } from '../repositories/operator.repository';
import { OperatorPermission, OperatorRole } from '../types/operator.types';
import { ConflictError, ForbiddenError, ServiceUnavailableError, ValidationError } from '../utils/errors';
import { hashOperatorValue, normalizeOperatorEmail } from '../utils/operator-security';
import { operatorAuthorizationService } from './operator-authorization.service';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function context(req: Request) {
  if (!req.operatorContext) throw new ServiceUnavailableError('Operator context is unavailable');
  return req.operatorContext;
}

async function auditMutation(req: Request, input: {
  correlationId: string;
  action: string;
  result: 'intent' | 'succeeded' | 'failed';
  targetLocationId?: string;
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const actor = context(req);
  await operatorAuthorizationService.auditRequest(req, {
    correlationId: input.correlationId,
    actorOperatorUserId: actor.operatorUserId,
    actorOrganizationId: actor.organizationId,
    actorRole: actor.role,
    actorSessionId: actor.sessionId,
    action: input.action,
    result: input.result,
    targetLocationId: input.targetLocationId,
    targetType: input.targetType,
    targetId: input.targetId,
    metadata: input.metadata,
  });
}

function assertPermission(req: Request, permission: OperatorPermission): void {
  if (!context(req).permissions.has(permission)) throw new ServiceUnavailableError('Operator permission context is invalid');
}

export const operatorAdminService = {
  async createInvitation(req: Request, input: {
    email: unknown;
    displayName: unknown;
    organizationId: unknown;
    role: unknown;
  }): Promise<{ invitationId: string; inviteUrl: string; expiresAt: string }> {
    assertPermission(req, 'operator.invitations.manage');
    const actor = context(req);
    const email = normalizeOperatorEmail(input.email);
    const displayName = String(input.displayName || '').trim().slice(0, 200);
    const organizationId = String(input.organizationId || '');
    const role = String(input.role || '') as OperatorRole;
    if (!email.includes('@') || !displayName || !UUID_PATTERN.test(organizationId) || !isOperatorRole(role)) {
      throw new ValidationError('Valid email, display name, organization, and role are required');
    }

    if (actor.role !== 'platform_owner' && organizationId !== actor.organizationId) {
      throw new ForbiddenError();
    }
    const organization = await operatorRepository.findActiveOrganization(organizationId);
    if (!organization) throw new ValidationError('Invitation organization is unavailable');
    const platformRole = ['platform_owner', 'platform_ops', 'platform_support', 'security_auditor'].includes(role);
    const resellerRole = ['reseller_owner', 'reseller_operator', 'reseller_viewer'].includes(role);
    if ((organization.organization_type === 'platform' && (!platformRole || actor.role !== 'platform_owner'))
      || (organization.organization_type === 'reseller' && !resellerRole)) {
      throw new ForbiddenError();
    }

    const correlationId = crypto.randomUUID();
    await auditMutation(req, {
      correlationId,
      action: 'operator.invitation.create',
      result: 'intent',
      targetType: 'operator_organization',
      targetId: organizationId,
      metadata: { role, email_hash: hashOperatorValue(email) },
    });

    const expiresAt = new Date(Date.now() + config.operator.invitationHours * 60 * 60 * 1000).toISOString();
    const { data, error } = await getSupabase().auth.admin.generateLink({
      type: 'invite',
      email,
      options: {
        redirectTo: `${config.operator.origin}/internal/operator/invite`,
        data: { display_name: displayName },
      },
    });
    if (error || !data.user?.id || !data.properties?.hashed_token) {
      await auditMutation(req, {
        correlationId,
        action: 'operator.invitation.create',
        result: 'failed',
        targetType: 'operator_organization',
        targetId: organizationId,
        metadata: { error_class: 'auth_invite_failed' },
      });
      throw new ServiceUnavailableError('Could not provision the operator invitation');
    }

    let invitation: any;
    try {
      invitation = await operatorRepository.createInvitation({
        organization_id: organizationId,
        email_normalized: email,
        display_name: displayName,
        role,
        invite_token_hash: hashOperatorValue(data.properties.hashed_token),
        auth_user_id: data.user.id,
        status: 'pending',
        invited_by_operator_user_id: actor.operatorUserId,
        expires_at: expiresAt,
      });
    } catch (err: any) {
      await auditMutation(req, {
        correlationId,
        action: 'operator.invitation.create',
        result: 'failed',
        targetType: 'operator_organization',
        targetId: organizationId,
        metadata: { error_class: 'invitation_row_rejected' },
      });
      if (/duplicate|unique|pending/i.test(err?.message || '')) throw new ConflictError('An active invitation already exists for this email');
      throw err;
    }

    await auditMutation(req, {
      correlationId,
      action: 'operator.invitation.create',
      result: 'succeeded',
      targetType: 'operator_invitation',
      targetId: invitation.id,
      metadata: { organization_id: organizationId, role, delivery: 'manual_one_time_link' },
    });

    return {
      invitationId: invitation.id,
      inviteUrl: `${config.operator.origin}/internal/operator/invite#invite=${encodeURIComponent(data.properties.hashed_token)}`,
      expiresAt,
    };
  },

  async createResellerOrganization(req: Request, input: { name: unknown; externalReference?: unknown }): Promise<any> {
    assertPermission(req, 'operator.organizations.manage');
    const name = String(input.name || '').trim().slice(0, 200);
    const externalReference = String(input.externalReference || '').trim().slice(0, 200);
    if (!name) throw new ValidationError('Reseller organization name is required');
    const correlationId = crypto.randomUUID();
    await auditMutation(req, {
      correlationId,
      action: 'operator.organization.create',
      result: 'intent',
      targetType: 'operator_organization',
      metadata: { organization_type: 'reseller' },
    });
    try {
      const organization = await operatorRepository.createResellerOrganization({
        name,
        externalReference,
        actorOperatorUserId: context(req).operatorUserId,
        correlationId,
      });
      return organization;
    } catch (err) {
      await auditMutation(req, {
        correlationId,
        action: 'operator.organization.create',
        result: 'failed',
        targetType: 'operator_organization',
        metadata: { error_class: 'database_rejected' },
      });
      throw err;
    }
  },

  async transferAssignment(req: Request, input: {
    locationId: unknown;
    resellerOrganizationId: unknown;
    reason: unknown;
  }): Promise<any> {
    assertPermission(req, 'operator.assignments.manage');
    const actor = context(req);
    const locationId = String(input.locationId || '').trim().slice(0, 100);
    const resellerOrganizationId = String(input.resellerOrganizationId || '');
    const reason = String(input.reason || '').trim().slice(0, 500);
    if (!locationId || !UUID_PATTERN.test(resellerOrganizationId) || !reason) {
      throw new ValidationError('Location, reseller organization, and transfer reason are required');
    }
    const correlationId = crypto.randomUUID();
    await auditMutation(req, {
      correlationId,
      action: 'operator.assignment.transfer',
      result: 'intent',
      targetLocationId: locationId,
      targetType: 'operator_organization',
      targetId: resellerOrganizationId,
    });
    try {
      return await operatorRepository.transferAssignment({
        locationId,
        resellerOrganizationId,
        actorOperatorUserId: actor.operatorUserId,
        reason,
        correlationId,
      });
    } catch (err) {
      await auditMutation(req, {
        correlationId,
        action: 'operator.assignment.transfer',
        result: 'failed',
        targetLocationId: locationId,
        targetType: 'operator_organization',
        targetId: resellerOrganizationId,
        metadata: { error_class: 'assignment_rejected' },
      });
      throw err;
    }
  },

  async requestSupportGrant(req: Request, input: {
    granteeOperatorUserId: unknown;
    locationId: unknown;
    reason: unknown;
    startsAt?: unknown;
    expiresAt: unknown;
  }): Promise<any> {
    assertPermission(req, 'operator.support_grants.manage');
    const actor = context(req);
    const granteeOperatorUserId = String(input.granteeOperatorUserId || '');
    const locationId = String(input.locationId || '').trim().slice(0, 100);
    const reason = String(input.reason || '').trim().slice(0, 500);
    const startsAt = input.startsAt ? new Date(String(input.startsAt)) : new Date();
    const expiresAt = new Date(String(input.expiresAt || ''));
    if (!UUID_PATTERN.test(granteeOperatorUserId) || !locationId || !reason
      || !Number.isFinite(startsAt.getTime()) || !Number.isFinite(expiresAt.getTime())
      || expiresAt <= startsAt) {
      throw new ValidationError('Valid support user, location, reason, and expiration are required');
    }
    const correlationId = crypto.randomUUID();
    await auditMutation(req, {
      correlationId,
      action: 'operator.support_grant.request',
      result: 'intent',
      targetLocationId: locationId,
      targetType: 'operator_user',
      targetId: granteeOperatorUserId,
    });
    try {
      const grant = await operatorRepository.createSupportGrant({
        granteeOperatorUserId,
        locationId,
        reason,
        startsAt: startsAt.toISOString(),
        expiresAt: expiresAt.toISOString(),
        requestedByOperatorUserId: actor.operatorUserId,
        correlationId,
      });
      return grant;
    } catch (err) {
      await auditMutation(req, {
        correlationId,
        action: 'operator.support_grant.request',
        result: 'failed',
        targetLocationId: locationId,
        targetType: 'operator_user',
        targetId: granteeOperatorUserId,
        metadata: { error_class: 'support_grant_rejected' },
      });
      throw err;
    }
  },

  async approveSupportGrant(req: Request, grantIdInput: unknown): Promise<any> {
    assertPermission(req, 'operator.support_grants.manage');
    const actor = context(req);
    const grantId = String(grantIdInput || '');
    if (!UUID_PATTERN.test(grantId)) throw new ValidationError('Valid support grant ID is required');
    const correlationId = crypto.randomUUID();
    await auditMutation(req, {
      correlationId,
      action: 'operator.support_grant.approve',
      result: 'intent',
      targetType: 'operator_support_grant',
      targetId: grantId,
    });
    try {
      const grant = await operatorRepository.approveSupportGrant(grantId, actor.operatorUserId, correlationId);
      if (!grant?.id) throw new ConflictError('Support grant is unavailable, expired, already decided, or needs a different approver');
      return grant;
    } catch (err) {
      await auditMutation(req, {
        correlationId,
        action: 'operator.support_grant.approve',
        result: 'failed',
        targetType: 'operator_support_grant',
        targetId: grantId,
        metadata: { error_class: 'support_grant_approval_rejected' },
      });
      throw err;
    }
  },

  async revokeSupportGrant(req: Request, grantIdInput: unknown): Promise<any> {
    assertPermission(req, 'operator.support_grants.manage');
    const actor = context(req);
    const grantId = String(grantIdInput || '');
    if (!UUID_PATTERN.test(grantId)) throw new ValidationError('Valid support grant ID is required');
    const correlationId = crypto.randomUUID();
    await auditMutation(req, {
      correlationId,
      action: 'operator.support_grant.revoke',
      result: 'intent',
      targetType: 'operator_support_grant',
      targetId: grantId,
    });
    try {
      const grant = await operatorRepository.revokeSupportGrant(grantId, actor.operatorUserId, correlationId);
      if (!grant?.id) throw new ConflictError('Support grant is unavailable or already revoked');
      return grant;
    } catch (err) {
      await auditMutation(req, {
        correlationId,
        action: 'operator.support_grant.revoke',
        result: 'failed',
        targetType: 'operator_support_grant',
        targetId: grantId,
        metadata: { error_class: 'support_grant_revocation_rejected' },
      });
      throw err;
    }
  },
};
