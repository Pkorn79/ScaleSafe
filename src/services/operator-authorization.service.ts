import { Request } from 'express';
import { config } from '../config';
import { operatorRepository, isOperatorRole } from '../repositories/operator.repository';
import {
  OperatorAuditInput,
  OperatorContext,
  OperatorPermission,
  OperatorRole,
} from '../types/operator.types';
import { logger } from '../utils/logger';
import { hashOperatorValue, operatorIpHash, operatorUserAgent } from '../utils/operator-security';

const ROLE_PERMISSIONS: Record<OperatorRole, readonly OperatorPermission[]> = {
  platform_owner: [
    'operator.session.read',
    'operator.audit.read',
    'operator.organizations.manage',
    'operator.invitations.manage',
    'operator.assignments.manage',
    'operator.support_grants.manage',
    'merchant.summary.read',
  ],
  platform_ops: ['operator.session.read', 'merchant.summary.read'],
  platform_support: ['operator.session.read', 'merchant.summary.read'],
  security_auditor: ['operator.session.read', 'operator.audit.read'],
  reseller_owner: ['operator.session.read', 'operator.invitations.manage', 'merchant.summary.read'],
  reseller_operator: ['operator.session.read', 'merchant.summary.read'],
  reseller_viewer: ['operator.session.read', 'merchant.summary.read'],
};

export interface OperatorResolution {
  context: OperatorContext | null;
  denialReason?: string;
  actor?: {
    operatorUserId?: string;
    organizationId?: string;
    membershipId?: string;
    sessionId?: string;
    role?: OperatorRole;
  };
}

function activeIdentityMatchesSession(session: any, identity: any): boolean {
  return Boolean(
    identity?.user?.id === session.operator_user_id
    && identity.user.status === 'active'
    && identity?.membership?.id === session.membership_id
    && identity.membership.operator_user_id === session.operator_user_id
    && identity.membership.organization_id === session.organization_id
    && identity.membership.status === 'active'
    && identity?.organization?.id === session.organization_id
    && identity.organization.status === 'active'
    && isOperatorRole(identity.membership.role),
  );
}

export const operatorAuthorizationService = {
  permissionsForRole(role: OperatorRole): ReadonlySet<OperatorPermission> {
    return new Set(ROLE_PERMISSIONS[role]);
  },

  async resolveSessionToken(sessionToken: string): Promise<OperatorResolution> {
    const sessionTokenHash = hashOperatorValue(sessionToken);
    const session = await operatorRepository.findSession(sessionTokenHash);
    if (!session) return { context: null, denialReason: 'session_missing_or_expired' };

    const identity = await operatorRepository.findLiveIdentityForSession(session);
    const role = isOperatorRole(identity?.membership?.role) ? identity.membership.role : undefined;
    const actor = {
      operatorUserId: session.operator_user_id,
      organizationId: session.organization_id,
      membershipId: session.membership_id,
      sessionId: session.id,
      role,
    };

    if (!activeIdentityMatchesSession(session, identity) || session.auth_assurance !== 'aal2' || !role) {
      return { context: null, denialReason: 'operator_identity_inactive', actor };
    }
    const activeIdentity = identity!;

    let mode: OperatorContext['locationAccess']['mode'] = 'none';
    let locations: string[] = [];
    if (role === 'platform_owner' || role === 'platform_ops') {
      mode = 'all';
    } else if (role === 'platform_support') {
      mode = 'support_grants';
      locations = await operatorRepository.listActiveSupportGrantLocations(session.operator_user_id);
    } else if (activeIdentity.organization.organization_type === 'reseller') {
      mode = 'assigned';
      locations = await operatorRepository.listActiveAssignmentLocations(session.organization_id);
    }

    const context: OperatorContext = Object.freeze({
      operatorUserId: session.operator_user_id,
      sessionId: session.id,
      organizationId: session.organization_id,
      organizationType: activeIdentity.organization.organization_type,
      membershipId: session.membership_id,
      role,
      permissions: this.permissionsForRole(role),
      locationAccess: Object.freeze({ mode, locationIds: new Set(locations) }),
      authAssurance: 'aal2' as const,
      csrfTokenHash: session.csrf_token_hash,
      sessionTokenHash,
    });

    const lastSeen = new Date(session.last_seen_at).getTime();
    if (Number.isFinite(lastSeen) && Date.now() - lastSeen >= 5 * 60 * 1000) {
      const absoluteExpiry = new Date(session.absolute_expires_at).getTime();
      const nextIdle = Math.min(
        Date.now() + config.operator.sessionIdleMinutes * 60 * 1000,
        absoluteExpiry,
      );
      operatorRepository.touchSession(
        session.id,
        new Date(nextIdle).toISOString(),
        new Date(Date.now() - 5 * 60 * 1000).toISOString(),
      ).catch((err) => logger.warn({ err, sessionId: session.id }, 'Operator session touch failed'));
    }

    return { context, actor };
  },

  canAccessLocation(context: OperatorContext, locationId: string): boolean {
    return context.locationAccess.mode === 'all' || context.locationAccess.locationIds.has(locationId);
  },

  hasPermission(context: OperatorContext, permission: OperatorPermission): boolean {
    return context.permissions.has(permission);
  },

  async auditRequest(req: Request, input: Omit<OperatorAuditInput, 'requestId' | 'ipAddressHash' | 'userAgent'>): Promise<string> {
    return operatorRepository.writeAudit({
      ...input,
      requestId: req.operatorRequestId,
      ipAddressHash: operatorIpHash(req),
      userAgent: operatorUserAgent(req),
    });
  },
};
