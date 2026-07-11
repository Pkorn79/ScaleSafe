import { getSupabase } from '../clients/supabase.client';
import {
  EvidenceConnectionRecord,
  EvidenceCredentialRecord,
  EvidenceEnrollmentContextRecord,
  ExternalEvidenceEventRecord,
} from '../types/evidence-connector.types';

const EVIDENCE_TABLES = new Set([
  'evidence_external_sessions',
  'evidence_attendance',
  'evidence_service_access',
  'evidence_modules',
  'evidence_course_completion',
  'evidence_milestones',
  'evidence_assignments',
  'evidence_resource_delivery',
  'evidence_communication',
  'evidence_custom_events',
  'evidence_pulse_checkins',
  'evidence_payment_confirmation',
]);

export const evidenceConnectorRepository = {
  async listConnections(locationId: string): Promise<EvidenceConnectionRecord[]> {
    const { data, error } = await getSupabase()
      .from('evidence_connections')
      .select('*')
      .eq('location_id', locationId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data || []) as EvidenceConnectionRecord[];
  },

  async getConnection(locationId: string, id: string): Promise<EvidenceConnectionRecord | null> {
    const { data, error } = await getSupabase()
      .from('evidence_connections')
      .select('*')
      .eq('location_id', locationId)
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    return data as EvidenceConnectionRecord | null;
  },

  async getConnectionByPublicId(publicId: string): Promise<EvidenceConnectionRecord | null> {
    const { data, error } = await getSupabase()
      .from('evidence_connections')
      .select('*')
      .eq('public_id', publicId)
      .maybeSingle();
    if (error) throw error;
    return data as EvidenceConnectionRecord | null;
  },

  async getConnectionByTypeAndSource(locationId: string, connectionType: string, sourceLabel: string): Promise<EvidenceConnectionRecord | null> {
    const { data, error } = await getSupabase()
      .from('evidence_connections')
      .select('*')
      .eq('location_id', locationId)
      .eq('connection_type', connectionType)
      .eq('source_label', sourceLabel)
      .maybeSingle();
    if (error) throw error;
    return data as EvidenceConnectionRecord | null;
  },

  async createConnection(input: Record<string, unknown>): Promise<EvidenceConnectionRecord> {
    const { data, error } = await getSupabase()
      .from('evidence_connections')
      .insert(input)
      .select('*')
      .single();
    if (error) throw error;
    return data as EvidenceConnectionRecord;
  },

  async updateConnection(locationId: string, id: string, updates: Record<string, unknown>): Promise<EvidenceConnectionRecord> {
    const { data, error } = await getSupabase()
      .from('evidence_connections')
      .update(updates)
      .eq('location_id', locationId)
      .eq('id', id)
      .select('*')
      .single();
    if (error) throw error;
    return data as EvidenceConnectionRecord;
  },

  async deleteConnection(locationId: string, id: string): Promise<void> {
    const { error } = await getSupabase().from('evidence_connections').delete().eq('location_id', locationId).eq('id', id);
    if (error) throw error;
  },

  async createCredential(input: Record<string, unknown>): Promise<EvidenceCredentialRecord> {
    const { data, error } = await getSupabase()
      .from('evidence_connection_credentials')
      .insert(input)
      .select('*')
      .single();
    if (error) throw error;
    return data as EvidenceCredentialRecord;
  },

  async findCredentialByHash(secretHash: string): Promise<{ credential: EvidenceCredentialRecord; connection: EvidenceConnectionRecord } | null> {
    const now = new Date().toISOString();
    const { data, error } = await getSupabase()
      .from('evidence_connection_credentials')
      .select('*, connection:evidence_connections(*)')
      .eq('secret_hash', secretHash)
      .in('status', ['active', 'expiring'])
      .or(`expires_at.is.null,expires_at.gt.${now}`)
      .maybeSingle();
    if (error) throw error;
    if (!data || !(data as any).connection) return null;
    const { connection, ...credential } = data as any;
    return { credential, connection };
  },

  async listActiveCredentials(connectionId: string, type?: string): Promise<EvidenceCredentialRecord[]> {
    let query: any = getSupabase()
      .from('evidence_connection_credentials')
      .select('*')
      .eq('connection_id', connectionId)
      .in('status', ['active', 'expiring']);
    if (type) query = query.eq('credential_type', type);
    const { data, error } = await query;
    if (error) throw error;
    const now = Date.now();
    return (data || []).filter((row: any) => !row.expires_at || new Date(row.expires_at).getTime() > now) as EvidenceCredentialRecord[];
  },

  async expireCredentials(connectionId: string, expiresAt: string): Promise<void> {
    const { error } = await getSupabase()
      .from('evidence_connection_credentials')
      .update({ status: 'expiring', expires_at: expiresAt })
      .eq('connection_id', connectionId)
      .eq('status', 'active');
    if (error) throw error;
  },

  async touchCredential(id: string): Promise<void> {
    await getSupabase().from('evidence_connection_credentials').update({ last_used_at: new Date().toISOString() }).eq('id', id);
  },

  async consumeRateLimit(connectionId: string, limit: number): Promise<boolean> {
    const { data, error } = await getSupabase().rpc('consume_evidence_connection_rate_limit', {
      p_connection_id: connectionId,
      p_limit: limit,
    });
    if (error) throw error;
    return data === true;
  },

  async replaceResourceMappings(locationId: string, connectionId: string, mappings: Array<Record<string, unknown>>): Promise<void> {
    const supabase = getSupabase();
    const { error: deleteError } = await supabase
      .from('evidence_resource_mappings')
      .delete()
      .eq('location_id', locationId)
      .eq('connection_id', connectionId);
    if (deleteError) throw deleteError;
    if (mappings.length === 0) return;
    const { error } = await supabase.from('evidence_resource_mappings').insert(mappings);
    if (error) throw error;
  },

  async listResourceMappings(locationId: string, connectionId: string): Promise<any[]> {
    const { data, error } = await getSupabase()
      .from('evidence_resource_mappings')
      .select('*, offer:offers_mirror(id, offer_name)')
      .eq('location_id', locationId)
      .eq('connection_id', connectionId)
      .order('created_at');
    if (error) throw error;
    return data || [];
  },

  async findResourceMapping(connectionId: string, resourceType: string, externalResourceId: string): Promise<any | null> {
    const { data, error } = await getSupabase()
      .from('evidence_resource_mappings')
      .select('*')
      .eq('connection_id', connectionId)
      .eq('resource_type', resourceType)
      .eq('external_resource_id', externalResourceId)
      .eq('approval_status', 'approved')
      .maybeSingle();
    if (error) throw error;
    return data || null;
  },

  async insertEvent(input: Record<string, unknown>): Promise<{ event: ExternalEvidenceEventRecord; duplicate: boolean }> {
    const { data, error } = await getSupabase()
      .from('external_evidence_events')
      .insert(input)
      .select('*')
      .single();
    if (!error) return { event: data as ExternalEvidenceEventRecord, duplicate: false };
    if (error.code !== '23505') throw error;

    const { data: existing, error: existingError } = await getSupabase()
      .from('external_evidence_events')
      .select('*')
      .eq('connection_id', input.connection_id)
      .eq('source_event_id', input.source_event_id)
      .single();
    if (existingError) throw existingError;
    return { event: existing as ExternalEvidenceEventRecord, duplicate: true };
  },

  async listEvents(locationId: string, connectionId: string, limit = 50): Promise<ExternalEvidenceEventRecord[]> {
    const { data, error } = await getSupabase()
      .from('external_evidence_events')
      .select('*, enrollment:enrollments(id, contact_id, email, offer_id, offer_name), offer:offers_mirror(id, offer_name)')
      .eq('location_id', locationId)
      .eq('connection_id', connectionId)
      .order('received_at', { ascending: false })
      .limit(Math.max(1, Math.min(limit, 200)));
    if (error) throw error;
    return (data || []) as ExternalEvidenceEventRecord[];
  },

  async connectionEventSummary(locationId: string, connectionId: string): Promise<any[]> {
    const { data, error } = await getSupabase()
      .from('external_evidence_events')
      .select('status, is_test, offer_id, published_at, received_at, offer:offers_mirror(id, offer_name)')
      .eq('location_id', locationId)
      .eq('connection_id', connectionId)
      .eq('is_test', false)
      .order('received_at', { ascending: false })
      .limit(1000);
    if (error) throw error;
    return data || [];
  },

  async findEnrollmentContextByRequest(connectionId: string, requestId: string): Promise<EvidenceEnrollmentContextRecord | null> {
    const { data, error } = await getSupabase()
      .from('evidence_enrollment_contexts')
      .select('*')
      .eq('connection_id', connectionId)
      .eq('request_id', requestId)
      .maybeSingle();
    if (error) throw error;
    return data as EvidenceEnrollmentContextRecord | null;
  },

  async findEnrollmentContextByTokenHash(value: string): Promise<EvidenceEnrollmentContextRecord | null> {
    const { data, error } = await getSupabase()
      .from('evidence_enrollment_contexts')
      .select('*')
      .eq('token_hash', value)
      .maybeSingle();
    if (error) throw error;
    return data as EvidenceEnrollmentContextRecord | null;
  },

  async createEnrollmentContext(input: Record<string, unknown>): Promise<EvidenceEnrollmentContextRecord> {
    const { data, error } = await getSupabase()
      .from('evidence_enrollment_contexts')
      .insert(input)
      .select('*')
      .single();
    if (error) throw error;
    return data as EvidenceEnrollmentContextRecord;
  },

  async claimEnrollmentContext(input: {
    tokenHash: string;
    offerId: string;
    email?: string;
    deviceEvidence?: Record<string, unknown> | null;
  }): Promise<any> {
    const { data, error } = await getSupabase().rpc('claim_evidence_enrollment_context', {
      p_token_hash: input.tokenHash,
      p_offer_id: input.offerId,
      p_email: input.email || null,
      p_device_evidence: input.deviceEvidence || null,
    });
    if (error) throw error;
    return Array.isArray(data) ? data[0] : data;
  },

  async updateEnrollmentContext(id: string, updates: Record<string, unknown>): Promise<void> {
    const { error } = await getSupabase().from('evidence_enrollment_contexts').update(updates).eq('id', id);
    if (error) throw error;
  },

  async expireEnrollmentContexts(): Promise<number> {
    const { data, error } = await getSupabase().rpc('expire_evidence_enrollment_contexts');
    if (error) throw error;
    return Number(data || 0);
  },

  async replayEligibleEvents(locationId: string, connectionId: string): Promise<number> {
    const eligibleCodes = [
      'ENROLLMENT_NOT_READY',
      'RESOURCE_NOT_MAPPED',
      'SUBJECT_IDENTITY_MISSING',
      'AMBIGUOUS_EMAIL_AND_OFFER',
      'AMBIGUOUS_EXTERNAL_CONTACT',
      'AMBIGUOUS_EXTERNAL_ENROLLMENT',
    ];
    const { data, error } = await getSupabase()
      .from('external_evidence_events')
      .update({
        status: 'retrying',
        next_attempt_at: new Date().toISOString(),
        lease_owner: null,
        lease_expires_at: null,
        error_code: null,
        error_message: null,
      })
      .eq('location_id', locationId)
      .eq('connection_id', connectionId)
      .eq('is_test', false)
      .in('status', ['quarantined', 'retrying'])
      .in('error_code', eligibleCodes)
      .select('id');
    if (error) throw error;
    return (data || []).length;
  },

  async credentialCount(connectionId: string): Promise<number> {
    const { count, error } = await getSupabase()
      .from('evidence_connection_credentials')
      .select('id', { count: 'exact', head: true })
      .eq('connection_id', connectionId)
      .in('status', ['active', 'expiring']);
    if (error) throw error;
    return count || 0;
  },

  async successfulTestCount(locationId: string, connectionId: string): Promise<number> {
    const { count, error } = await getSupabase()
      .from('external_evidence_events')
      .select('id', { count: 'exact', head: true })
      .eq('location_id', locationId)
      .eq('connection_id', connectionId)
      .eq('is_test', true)
      .eq('status', 'published');
    if (error) throw error;
    return count || 0;
  },

  async claimEvents(workerId: string, limit = 20): Promise<ExternalEvidenceEventRecord[]> {
    const { data, error } = await getSupabase().rpc('claim_external_evidence_events', {
      p_limit: limit,
      p_worker_id: workerId,
      p_lease_seconds: 90,
    });
    if (error) throw error;
    return (data || []) as ExternalEvidenceEventRecord[];
  },

  async updateEvent(id: string, updates: Record<string, unknown>): Promise<void> {
    const { error } = await getSupabase().from('external_evidence_events').update(updates).eq('id', id);
    if (error) throw error;
  },

  async findSubjectByRef(locationId: string, enrollmentRef: string): Promise<any | null> {
    const { data, error } = await getSupabase()
      .from('evidence_subjects')
      .select('*, enrollment:enrollments(*), offer:offers_mirror(id, offer_name)')
      .eq('location_id', locationId)
      .eq('enrollment_ref', enrollmentRef)
      .maybeSingle();
    if (error) throw error;
    return data || null;
  },

  async getSubjectByEnrollment(locationId: string, enrollmentId: string): Promise<any | null> {
    const { data, error } = await getSupabase()
      .from('evidence_subjects')
      .select('*, enrollment:enrollments(*), offer:offers_mirror(id, offer_name)')
      .eq('location_id', locationId)
      .eq('enrollment_id', enrollmentId)
      .maybeSingle();
    if (error) throw error;
    return data || null;
  },

  async listSubjects(locationId: string, limit = 100): Promise<any[]> {
    const { data, error } = await getSupabase()
      .from('evidence_subjects')
      .select('id, enrollment_id, contact_id, offer_id, enrollment_ref, normalized_email, enrollment:enrollments(status, enrolled_at), offer:offers_mirror(offer_name)')
      .eq('location_id', locationId)
      .order('created_at', { ascending: false })
      .limit(Math.max(1, Math.min(limit, 200)));
    if (error) throw error;
    return data || [];
  },

  async findSubjectsByIdentity(connectionId: string, externalContactId?: string, externalEnrollmentId?: string): Promise<any[]> {
    let query: any = getSupabase()
      .from('evidence_subject_identities')
      .select('*, subject:evidence_subjects(*, enrollment:enrollments(*), offer:offers_mirror(id, offer_name))')
      .eq('connection_id', connectionId);
    if (externalEnrollmentId) query = query.eq('external_enrollment_id', externalEnrollmentId);
    else if (externalContactId) query = query.eq('external_contact_id', externalContactId);
    else return [];
    const { data, error } = await query.limit(5);
    if (error) throw error;
    return (data || []).map((row: any) => row.subject).filter(Boolean);
  },

  async findSubjectsByEmailAndOffer(locationId: string, normalizedEmail: string, offerId: string): Promise<any[]> {
    const { data, error } = await getSupabase()
      .from('evidence_subjects')
      .select('*, enrollment:enrollments(*), offer:offers_mirror(id, offer_name)')
      .eq('location_id', locationId)
      .eq('normalized_email', normalizedEmail)
      .eq('offer_id', offerId)
      .limit(3);
    if (error) throw error;
    return data || [];
  },

  async findSubjectsByEmail(locationId: string, normalizedEmail: string): Promise<any[]> {
    const { data, error } = await getSupabase()
      .from('evidence_subjects')
      .select('*, enrollment:enrollments(*), offer:offers_mirror(id, offer_name, delivery_method)')
      .eq('location_id', locationId)
      .eq('normalized_email', normalizedEmail)
      .limit(50);
    if (error) throw error;
    return data || [];
  },

  async persistIdentity(input: Record<string, unknown>): Promise<void> {
    const rows: Record<string, unknown>[] = [];
    if (input.external_contact_id) rows.push({ ...input, external_enrollment_id: null });
    if (input.external_enrollment_id) rows.push({ ...input, external_contact_id: null });
    for (const row of rows) {
      let query: any = getSupabase()
        .from('evidence_subject_identities')
        .select('id')
        .eq('connection_id', row.connection_id)
        .eq('subject_id', row.subject_id);
      query = row.external_enrollment_id
        ? query.eq('external_enrollment_id', row.external_enrollment_id)
        : query.eq('external_contact_id', row.external_contact_id);
      const { data: existing, error: findError } = await query.maybeSingle();
      if (findError) throw findError;
      const operation = existing
        ? getSupabase().from('evidence_subject_identities').update(row).eq('id', existing.id)
        : getSupabase().from('evidence_subject_identities').insert(row);
      const { error } = await operation;
      if (error) throw error;
    }
  },

  async insertTypedEvidence(table: string, input: Record<string, unknown>): Promise<string> {
    if (!EVIDENCE_TABLES.has(table)) throw new Error(`Connector cannot write evidence table ${table}`);
    const { data, error } = await getSupabase().from(table).insert(input).select('id').single();
    if (error) throw error;
    return data.id;
  },

  async findEvidenceByConnectorEvent(table: string, connectorEventId: string): Promise<string | null> {
    if (!EVIDENCE_TABLES.has(table)) throw new Error(`Connector cannot query evidence table ${table}`);
    const { data, error } = await getSupabase()
      .from(table)
      .select('id')
      .eq('connector_event_id', connectorEventId)
      .maybeSingle();
    if (error) throw error;
    return data?.id || null;
  },

  async createAttachment(input: Record<string, unknown>): Promise<any> {
    const { data, error } = await getSupabase().from('external_evidence_attachments').insert(input).select('*').single();
    if (error) throw error;
    return data;
  },

  async getAttachment(connectionId: string, id: string): Promise<any | null> {
    const { data, error } = await getSupabase()
      .from('external_evidence_attachments')
      .select('*')
      .eq('connection_id', connectionId)
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    return data || null;
  },

  async updateAttachment(id: string, updates: Record<string, unknown>): Promise<void> {
    const { error } = await getSupabase().from('external_evidence_attachments').update(updates).eq('id', id);
    if (error) throw error;
  },

  async audit(locationId: string, connectionId: string | null, action: string, actorLabel: string, metadata: Record<string, unknown> = {}): Promise<void> {
    const { error } = await getSupabase().from('evidence_connection_audit_logs').insert({
      location_id: locationId,
      connection_id: connectionId,
      action,
      actor_label: actorLabel,
      metadata,
    });
    if (error) throw error;
  },

  async updateConnectionHealth(connectionId: string, success: boolean, message?: string): Promise<void> {
    const now = new Date().toISOString();
    const updates = success
      ? { health_status: 'healthy', last_success_at: now, last_event_at: now, last_error_message: null }
      : { health_status: 'error', last_error_at: now, last_error_message: message || 'Connector processing failed' };
    const { error } = await getSupabase().from('evidence_connections').update(updates).eq('id', connectionId);
    if (error) throw error;
  },

  async updateConnectionWarning(connectionId: string, message: string): Promise<void> {
    const { error } = await getSupabase().from('evidence_connections').update({
      health_status: 'warning',
      last_error_at: new Date().toISOString(),
      last_error_message: message.slice(0, 500),
    }).eq('id', connectionId);
    if (error) throw error;
  },

  async getHqSummary(): Promise<any[]> {
    const { data, error } = await getSupabase()
      .from('evidence_connections')
      .select('id, location_id, name, source_label, connection_type, provider_key, auth_mode, external_account_id, external_account_name, provider_capabilities, status, setup_status, setup_mode, identity_strategy, activated_at, health_status, last_event_at, last_success_at, last_error_at, last_error_message, created_at')
      .order('last_event_at', { ascending: false, nullsFirst: false });
    if (error) throw error;
    return data || [];
  },
};
