import { getSupabase } from '../clients/supabase.client';
import { OperatorAuditInput, OperatorRole } from '../types/operator.types';
import { sanitizeOperatorMetadata } from '../utils/operator-security';

function throwIfError(error: any, context: string): void {
  if (error) throw new Error(`${context}: ${error.message || String(error)}`);
}

export interface OperatorIdentityRecord {
  user: any;
  membership: any;
  organization: any;
}

export interface OperatorSessionContextRecord {
  session_id: string;
  operator_user_id: string;
  organization_id: string;
  membership_id: string;
  auth_assurance: string;
  csrf_token_hash: string;
  last_seen_at: string;
  absolute_expires_at: string;
  user_id: string;
  user_status: string;
  membership_operator_user_id: string;
  membership_organization_id: string;
  membership_status: string;
  membership_role: string;
  organization_status: string;
  organization_type: string;
  location_access_mode: string;
  location_ids: string[];
}

export const operatorRepository = {
  async findIdentityByAuthUserId(authUserId: string): Promise<OperatorIdentityRecord | null> {
    const supabase = getSupabase();
    const { data: user, error: userError } = await supabase
      .from('operator_users')
      .select('*')
      .eq('auth_user_id', authUserId)
      .maybeSingle();
    throwIfError(userError, 'Operator user lookup failed');
    if (!user) return null;

    const { data: membership, error: membershipError } = await supabase
      .from('operator_memberships')
      .select('*')
      .eq('operator_user_id', user.id)
      .eq('status', 'active')
      .maybeSingle();
    throwIfError(membershipError, 'Operator membership lookup failed');
    if (!membership) return { user, membership: null, organization: null };

    const { data: organization, error: organizationError } = await supabase
      .from('operator_organizations')
      .select('*')
      .eq('id', membership.organization_id)
      .maybeSingle();
    throwIfError(organizationError, 'Operator organization lookup failed');
    return { user, membership, organization };
  },

  async createAuthAttempt(input: Record<string, unknown>): Promise<any> {
    const { data, error } = await getSupabase()
      .from('operator_auth_attempts')
      .insert(input)
      .select('*')
      .single();
    throwIfError(error, 'Operator auth attempt creation failed');
    return data;
  },

  async findAuthAttempt(attemptTokenHash: string): Promise<any | null> {
    const { data, error } = await getSupabase()
      .from('operator_auth_attempts')
      .select('*')
      .eq('attempt_token_hash', attemptTokenHash)
      .in('state', ['mfa_enrollment', 'mfa_required'])
      .is('consumed_at', null)
      .gt('expires_at', new Date().toISOString())
      .maybeSingle();
    throwIfError(error, 'Operator auth attempt lookup failed');
    return data || null;
  },

  async setAuthAttemptFactor(id: string, factorId: string): Promise<boolean> {
    const { data, error } = await getSupabase()
      .from('operator_auth_attempts')
      .update({
        mfa_factor_id: factorId,
        state: 'mfa_required',
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('state', 'mfa_enrollment')
      .is('consumed_at', null)
      .gt('expires_at', new Date().toISOString())
      .select('id')
      .maybeSingle();
    throwIfError(error, 'Operator MFA enrollment state update failed');
    return Boolean(data?.id);
  },

  async incrementAuthAttemptFailure(id: string): Promise<void> {
    const { error } = await getSupabase().rpc('record_operator_auth_attempt_failure', {
      p_attempt_id: id,
    });
    throwIfError(error, 'Operator auth attempt failure update failed');
  },

  async completeAuthAttempt(input: {
    attemptTokenHash: string;
    sessionTokenHash: string;
    csrfTokenHash: string;
    idleExpiresAt: string;
    absoluteExpiresAt: string;
    ipAddressHash: string;
    userAgent: string;
  }): Promise<any> {
    const { data, error } = await getSupabase().rpc('complete_operator_auth_attempt', {
      p_attempt_token_hash: input.attemptTokenHash,
      p_session_token_hash: input.sessionTokenHash,
      p_csrf_token_hash: input.csrfTokenHash,
      p_idle_expires_at: input.idleExpiresAt,
      p_absolute_expires_at: input.absoluteExpiresAt,
      p_ip_address_hash: input.ipAddressHash,
      p_user_agent: input.userAgent,
    });
    throwIfError(error, 'Operator auth completion failed');
    return data;
  },

  async findSession(sessionTokenHash: string): Promise<any | null> {
    const { data, error } = await getSupabase()
      .from('operator_sessions')
      .select('*')
      .eq('session_token_hash', sessionTokenHash)
      .is('revoked_at', null)
      .gt('idle_expires_at', new Date().toISOString())
      .gt('absolute_expires_at', new Date().toISOString())
      .maybeSingle();
    throwIfError(error, 'Operator session lookup failed');
    return data || null;
  },

  async resolveSessionContext(
    sessionTokenHash: string,
  ): Promise<OperatorSessionContextRecord | null> {
    const { data, error } = await getSupabase().rpc('resolve_operator_session_context', {
      p_session_token_hash: sessionTokenHash,
    });
    throwIfError(error, 'Operator session context lookup failed');
    const row = Array.isArray(data) ? data[0] : data;
    return row || null;
  },

  async findLiveIdentityForSession(session: any): Promise<OperatorIdentityRecord | null> {
    const supabase = getSupabase();
    const [{ data: user, error: userError }, { data: membership, error: membershipError }, { data: organization, error: organizationError }] = await Promise.all([
      supabase.from('operator_users').select('*').eq('id', session.operator_user_id).maybeSingle(),
      supabase.from('operator_memberships').select('*').eq('id', session.membership_id).maybeSingle(),
      supabase.from('operator_organizations').select('*').eq('id', session.organization_id).maybeSingle(),
    ]);
    throwIfError(userError, 'Live operator user lookup failed');
    throwIfError(membershipError, 'Live operator membership lookup failed');
    throwIfError(organizationError, 'Live operator organization lookup failed');
    if (!user || !membership || !organization) return null;
    return { user, membership, organization };
  },

  async listActiveAssignmentLocations(organizationId: string): Promise<string[]> {
    const { data, error } = await getSupabase()
      .from('reseller_merchant_assignments')
      .select('location_id')
      .eq('reseller_organization_id', organizationId)
      .eq('status', 'active');
    throwIfError(error, 'Reseller assignment lookup failed');
    return (data || []).map((row: any) => String(row.location_id));
  },

  async listActiveSupportGrantLocations(operatorUserId: string): Promise<string[]> {
    const now = new Date().toISOString();
    const { data, error } = await getSupabase()
      .from('operator_support_grants')
      .select('location_id')
      .eq('grantee_operator_user_id', operatorUserId)
      .eq('status', 'active')
      .lte('starts_at', now)
      .gt('expires_at', now);
    throwIfError(error, 'Operator support grant lookup failed');
    return (data || []).map((row: any) => String(row.location_id));
  },

  async touchSession(id: string, idleExpiresAt: string, lastSeenBefore: string): Promise<void> {
    const { error } = await getSupabase()
      .from('operator_sessions')
      .update({ last_seen_at: new Date().toISOString(), idle_expires_at: idleExpiresAt })
      .eq('id', id)
      .is('revoked_at', null)
      .lte('last_seen_at', lastSeenBefore);
    throwIfError(error, 'Operator session touch failed');
  },

  async revokeCurrentSession(input: {
    sessionId: string;
    actorOperatorUserId: string;
    reason: string;
    correlationId: string;
  }): Promise<boolean> {
    const { data, error } = await getSupabase().rpc('revoke_current_operator_session', {
      p_session_id: input.sessionId,
      p_actor_operator_user_id: input.actorOperatorUserId,
      p_reason: input.reason,
      p_correlation_id: input.correlationId,
    });
    throwIfError(error, 'Operator session revocation failed');
    return data === true;
  },

  async writeAudit(input: OperatorAuditInput): Promise<string> {
    const { data, error } = await getSupabase()
      .from('operator_audit_events')
      .insert({
        correlation_id: input.correlationId,
        request_id: input.requestId || null,
        actor_operator_user_id: input.actorOperatorUserId || null,
        actor_organization_id: input.actorOrganizationId || null,
        actor_role: input.actorRole || null,
        actor_session_id: input.actorSessionId || null,
        action: input.action,
        result: input.result,
        target_location_id: input.targetLocationId || null,
        target_type: input.targetType || null,
        target_id: input.targetId || null,
        ip_address_hash: input.ipAddressHash || null,
        user_agent: (input.userAgent || '').slice(0, 500),
        metadata: sanitizeOperatorMetadata(input.metadata || {}),
      })
      .select('id')
      .single();
    throwIfError(error, 'Operator audit write failed');
    if (!data?.id) throw new Error('Operator audit write returned no record');
    return String(data.id);
  },

  async consumeRateLimit(bucketType: string, keyHash: string, maxRequests: number, windowSeconds: number): Promise<boolean> {
    const { data, error } = await getSupabase().rpc('consume_operator_rate_limit', {
      p_bucket_type: bucketType,
      p_key_hash: keyHash,
      p_max_requests: maxRequests,
      p_window_seconds: windowSeconds,
    });
    throwIfError(error, 'Operator rate limit check failed');
    return data === true;
  },

  async findActiveOrganization(id: string): Promise<any | null> {
    const { data, error } = await getSupabase()
      .from('operator_organizations')
      .select('id, organization_type, status')
      .eq('id', id)
      .eq('status', 'active')
      .maybeSingle();
    throwIfError(error, 'Operator organization lookup failed');
    return data || null;
  },

  async createInvitation(input: Record<string, unknown>): Promise<any> {
    const { data, error } = await getSupabase()
      .from('operator_invitations')
      .insert(input)
      .select('*')
      .single();
    throwIfError(error, 'Operator invitation creation failed');
    return data;
  },

  async claimInvitation(tokenHash: string, email: string): Promise<any | null> {
    const { data, error } = await getSupabase().rpc('claim_operator_invitation', {
      p_invite_token_hash: tokenHash,
      p_email_normalized: email,
    });
    throwIfError(error, 'Operator invitation claim failed');
    return data?.id ? data : null;
  },

  async releaseInvitation(id: string, message: string): Promise<void> {
    const { error } = await getSupabase().rpc('release_operator_invitation', {
      p_invitation_id: id,
      p_error: message.slice(0, 500),
    });
    throwIfError(error, 'Operator invitation release failed');
  },

  async completeInvitation(input: {
    invitationId: string;
    authUserId: string;
    email: string;
    displayName: string;
  }): Promise<any> {
    const { data, error } = await getSupabase().rpc('complete_operator_invitation', {
      p_invitation_id: input.invitationId,
      p_auth_user_id: input.authUserId,
      p_email_normalized: input.email,
      p_display_name: input.displayName,
    });
    throwIfError(error, 'Operator invitation completion failed');
    return data;
  },

  async createResellerOrganization(input: {
    name: string;
    externalReference?: string;
    actorOperatorUserId: string;
    correlationId: string;
  }): Promise<any> {
    const { data, error } = await getSupabase().rpc('create_operator_reseller_organization', {
      p_name: input.name,
      p_external_reference: input.externalReference || '',
      p_actor_operator_user_id: input.actorOperatorUserId,
      p_correlation_id: input.correlationId,
    });
    throwIfError(error, 'Reseller organization creation failed');
    return data;
  },

  async transferAssignment(input: {
    locationId: string;
    resellerOrganizationId: string;
    actorOperatorUserId: string;
    reason: string;
    correlationId: string;
  }): Promise<any> {
    const { data, error } = await getSupabase().rpc('transfer_primary_reseller_assignment', {
      p_location_id: input.locationId,
      p_reseller_organization_id: input.resellerOrganizationId,
      p_actor_operator_user_id: input.actorOperatorUserId,
      p_reason: input.reason,
      p_correlation_id: input.correlationId,
    });
    throwIfError(error, 'Reseller assignment transfer failed');
    return data;
  },

  async createSupportGrant(input: {
    granteeOperatorUserId: string;
    locationId: string;
    reason: string;
    startsAt: string;
    expiresAt: string;
    requestedByOperatorUserId: string;
    correlationId: string;
  }): Promise<any> {
    const { data, error } = await getSupabase().rpc('request_operator_support_grant', {
      p_grantee_operator_user_id: input.granteeOperatorUserId,
      p_location_id: input.locationId,
      p_reason: input.reason,
      p_starts_at: input.startsAt,
      p_expires_at: input.expiresAt,
      p_requested_by_operator_user_id: input.requestedByOperatorUserId,
      p_correlation_id: input.correlationId,
    });
    throwIfError(error, 'Operator support grant request failed');
    return data;
  },

  async approveSupportGrant(id: string, approverOperatorUserId: string, correlationId: string): Promise<any> {
    const { data, error } = await getSupabase().rpc('approve_operator_support_grant', {
      p_grant_id: id,
      p_approver_operator_user_id: approverOperatorUserId,
      p_correlation_id: correlationId,
    });
    throwIfError(error, 'Operator support grant approval failed');
    return data || null;
  },

  async revokeSupportGrant(id: string, actorOperatorUserId: string, correlationId: string): Promise<any> {
    const { data, error } = await getSupabase().rpc('revoke_operator_support_grant', {
      p_grant_id: id,
      p_actor_operator_user_id: actorOperatorUserId,
      p_correlation_id: correlationId,
    });
    throwIfError(error, 'Operator support grant revocation failed');
    return data || null;
  },

  async getMerchantSummary(locationId: string): Promise<any | null> {
    const { data, error } = await getSupabase()
      .from('merchants')
      .select('location_id, business_name, status, installed_at, marketplace_plan_key, marketplace_billing_status')
      .eq('location_id', locationId)
      .maybeSingle();
    throwIfError(error, 'Operator merchant summary lookup failed');
    return data || null;
  },

  async listAuditEvents(limit = 100): Promise<any[]> {
    const { data, error } = await getSupabase()
      .from('operator_audit_events')
      .select('id, correlation_id, actor_operator_user_id, actor_organization_id, actor_role, action, result, target_location_id, target_type, target_id, occurred_at')
      .order('occurred_at', { ascending: false })
      .limit(Math.max(1, Math.min(limit, 200)));
    throwIfError(error, 'Operator audit event lookup failed');
    return data || [];
  },
};

export function isOperatorRole(value: unknown): value is OperatorRole {
  return [
    'platform_owner',
    'platform_ops',
    'platform_support',
    'security_auditor',
    'reseller_owner',
    'reseller_operator',
    'reseller_viewer',
  ].includes(String(value));
}
