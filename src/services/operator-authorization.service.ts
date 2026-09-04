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
    'platform.health.read',
    'platform.merchants.read',
    'platform.resellers.read',
    'platform.incidents.manage',
    'merchant.summary.read',
  ],
  platform_ops: [
    'operator.session.read',
    'platform.health.read',
    'platform.merchants.read',
    'platform.incidents.manage',
    'merchant.summary.read',
  ],
  platform_support: ['operator.session.read', 'platform.health.read', 'merchant.summary.read'],
  security_auditor: ['operator.session.read', 'operator.audit.read', 'platform.health.read'],
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

function activeSessionContext(record: any): boolean {
  const roleMatchesOrganization = record?.organization_type === 'platform'
    ? ['platform_owner', 'platform_ops', 'platform_support', 'security_auditor'].includes(record?.membership_role)
    : record?.organization_type === 'reseller'
      && ['reseller_owner', 'reseller_operator', 'reseller_viewer'].includes(record?.membership_role);
  return Boolean(
    record?.user_id === record?.operator_user_id
    && record.user_status === 'active'
    && record?.membership_operator_user_id === record?.operator_user_id
    && record.membership_organization_id === record.organization_id
    && record.membership_status === 'active'
    && record.organization_status === 'active'
    && ['platform', 'reseller'].includes(record.organization_type)
    && isOperatorRole(record.membership_role)
    && roleMatchesOrganization,
  );
}

export const operatorAuthorizationService = {
  permissionsForRole(role: OperatorRole): ReadonlySet<OperatorPermission> {
    return new Set(ROLE_PERMISSIONS[role]);
  },

  async resolveSessionToken(sessionToken: string): Promise<OperatorResolution> {
    const sessionTokenHash = hashOperatorValue(sessionToken);
    const session = await operatorRepository.resolveSessionContext(sessionTokenHash);
    if (!session) return { context: null, denialReason: 'session_missing_or_expired' };

    const role = isOperatorRole(session.membership_role) ? session.membership_role : undefined;
    const actor = {
      operatorUserId: session.operator_user_id,
      organizationId: session.organization_id,
      membershipId: session.membership_id,
      sessionId: session.session_id,
      role,
    };

    if (!activeSessionContext(session) || session.auth_assurance !== 'aal2' || !role) {
      return { context: null, denialReason: 'operator_identity_inactive', actor };
    }

    const mode: OperatorContext['locationAccess']['mode'] = role === 'platform_owner' || role === 'platform_ops'
      ? 'all'
      : role === 'platform_support'
        ? 'support_grants'
        : session.organization_type === 'reseller'
          ? 'assigned'
          : 'none';
    const locations = Array.isArray(session.location_ids)
      ? session.location_ids.map(String)
      : [];

    const context: OperatorContext = Object.freeze({
      operatorUserId: session.operator_user_id,
      sessionId: session.session_id,
      organizationId: session.organization_id,
      organizationType: session.organization_type as OperatorContext['organizationType'],
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
        session.session_id,
        new Date(nextIdle).toISOString(),
        new Date(Date.now() - 5 * 60 * 1000).toISOString(),
      ).catch((err) => logger.warn(
        { err, sessionId: session.session_id },
        'Operator session touch failed',
      ));
    }

    return { context, actor };
  },

  canAccessLocation(context: OperatorContext, locationId: string): boolean {
    const hasPlatformWideAccess = context.organizationType === 'platform'
      && ['platform_owner', 'platform_ops'].includes(context.role)
      && context.locationAccess.mode === 'all';
    return hasPlatformWideAccess || context.locationAccess.locationIds.has(locationId);
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
