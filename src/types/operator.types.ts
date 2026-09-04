export type OperatorOrganizationType = 'platform' | 'reseller';

export type OperatorRole =
  | 'platform_owner'
  | 'platform_ops'
  | 'platform_support'
  | 'security_auditor'
  | 'reseller_owner'
  | 'reseller_operator'
  | 'reseller_viewer';

export type OperatorPermission =
  | 'operator.session.read'
  | 'operator.audit.read'
  | 'operator.organizations.manage'
  | 'operator.invitations.manage'
  | 'operator.assignments.manage'
  | 'operator.support_grants.manage'
  | 'platform.health.read'
  | 'platform.merchants.read'
  | 'platform.resellers.read'
  | 'platform.incidents.manage'
  | 'merchant.summary.read';

export interface OperatorContext {
  operatorUserId: string;
  sessionId: string;
  organizationId: string;
  organizationType: OperatorOrganizationType;
  membershipId: string;
  role: OperatorRole;
  permissions: ReadonlySet<OperatorPermission>;
  locationAccess: {
    mode: 'all' | 'assigned' | 'support_grants' | 'none';
    locationIds: ReadonlySet<string>;
  };
  authAssurance: 'aal2';
  csrfTokenHash: string;
  sessionTokenHash: string;
}

export interface OperatorAuditInput {
  correlationId?: string;
  requestId?: string;
  actorOperatorUserId?: string;
  actorOrganizationId?: string;
  actorRole?: OperatorRole;
  actorSessionId?: string;
  action: string;
  result: 'intent' | 'allowed' | 'denied' | 'succeeded' | 'failed';
  targetLocationId?: string;
  targetType?: string;
  targetId?: string;
  ipAddressHash?: string;
  userAgent?: string;
  metadata?: Record<string, unknown>;
}
