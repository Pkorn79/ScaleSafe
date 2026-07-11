export type EvidenceConnectionType = 'canonical_api' | 'raw_webhook' | 'legacy_external';
export type EvidenceCredentialType = 'api_key' | 'hmac' | 'url_secret';
export type EvidenceConnectionSetupStatus = 'draft' | 'testing' | 'active' | 'needs_attention' | 'disabled';
export type EvidenceConnectionSetupMode = 'operator_managed' | 'developer_api' | 'native_adapter';
export type ExternalEvidenceEventStatus =
  | 'received'
  | 'verified'
  | 'resolving'
  | 'published'
  | 'duplicate'
  | 'retrying'
  | 'quarantined'
  | 'rejected';

export type CanonicalActorType = 'client' | 'merchant' | 'provider' | 'system';

export interface CanonicalEvidenceEvent {
  schema_version: '1.0';
  event_id: string;
  event_type: string;
  occurred_at: string;
  subject: {
    enrollment_ref?: string;
    external_contact_id?: string;
    external_enrollment_id?: string;
    email?: string;
  };
  resource?: {
    type?: string;
    id?: string;
    name?: string;
  };
  actor?: {
    type?: CanonicalActorType;
    external_id?: string;
    name?: string;
    email?: string;
    ip_address?: string;
    device_fingerprint?: string;
  };
  activity?: {
    status?: string;
    title?: string;
    description?: string;
    duration_seconds?: number;
    progress_percent?: number;
    result?: string;
    started_at?: string;
    ended_at?: string;
  };
  attachments?: Array<{
    attachment_id?: string;
    url?: string;
    filename?: string;
    label?: string;
  }>;
  metadata?: Record<string, unknown>;
  is_test?: boolean;
}

export interface RawWebhookMappingConfig {
  name?: string;
  matchPath?: string;
  matchValue?: string;
  eventIdPath: string;
  eventTypePath?: string;
  eventTypeValue?: string;
  eventTypeMap?: Record<string, string>;
  occurredAtPath: string;
  enrollmentRefPath?: string;
  contactEmailPath?: string;
  externalContactIdPath?: string;
  externalEnrollmentIdPath?: string;
  resourceTypePath?: string;
  resourceTypeValue?: string;
  resourceIdPath?: string;
  resourceNamePath?: string;
  attachmentUrlPath?: string;
  attachmentFilenamePath?: string;
  actorTypePath?: string;
  actorTypeValue?: CanonicalActorType;
  actorExternalIdPath?: string;
  actorNamePath?: string;
  actorEmailPath?: string;
  activity?: Record<string, string>;
  approvedCustomTypes?: string[];
}

export interface RawWebhookConnectionConfig {
  mappings: RawWebhookMappingConfig[];
  approvedCustomTypes?: string[];
}

export interface EvidenceConnectionRecord {
  id: string;
  merchant_id: string;
  location_id: string;
  public_id: string;
  name: string;
  source_label: string;
  connection_type: EvidenceConnectionType;
  status: 'active' | 'disabled' | 'error';
  health_status: 'ready' | 'healthy' | 'warning' | 'error' | 'disabled';
  mapping_config: RawWebhookConnectionConfig | RawWebhookMappingConfig | Record<string, never>;
  allowed_attachment_domains: string[];
  rate_limit_per_minute: number;
  last_event_at: string | null;
  last_success_at: string | null;
  last_error_at: string | null;
  last_error_message: string | null;
  created_at: string;
  updated_at: string;
  setup_status: EvidenceConnectionSetupStatus;
  setup_mode: EvidenceConnectionSetupMode;
  identity_strategy: 'enrollment_context' | 'external_enrollment' | 'external_contact_resource' | 'email_resource_bootstrap';
  activated_at: string | null;
  configured_by: string | null;
}

export interface EvidenceEnrollmentContextRecord {
  id: string;
  connection_id: string;
  merchant_id: string;
  location_id: string;
  request_id: string;
  external_contact_id: string;
  external_enrollment_id: string;
  resource_type: string;
  external_resource_id: string;
  offer_id: string;
  checkout_mode: 'full_enrollment' | 'quick_checkout';
  token_hash: string;
  token_encrypted: string | null;
  status: 'pending' | 'attached' | 'bound' | 'expired' | 'revoked';
  expires_at: string;
  enrollment_id: string | null;
  attached_at: string | null;
  bound_at: string | null;
  revoked_at: string | null;
  binding_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface EvidenceCredentialRecord {
  id: string;
  connection_id: string;
  credential_type: EvidenceCredentialType;
  key_prefix: string;
  secret_hash: string;
  secret_encrypted: string | null;
  status: 'active' | 'expiring' | 'revoked';
  expires_at: string | null;
}

export interface ExternalEvidenceEventRecord {
  id: string;
  connection_id: string;
  merchant_id: string;
  location_id: string;
  source_event_id: string;
  schema_version: string;
  event_type: string;
  occurred_at: string;
  received_at: string;
  status: ExternalEvidenceEventStatus;
  auth_method: string;
  signature_verified: boolean;
  is_test: boolean;
  raw_payload: Record<string, unknown>;
  normalized_payload: CanonicalEvidenceEvent | null;
  payload_hash: string;
  subject_id: string | null;
  enrollment_id: string | null;
  contact_id: string | null;
  offer_id: string | null;
  resolution_method: string | null;
  evidence_type: string | null;
  evidence_table: string | null;
  evidence_record_id: string | null;
  attempts: number;
  error_code: string | null;
  error_message: string | null;
}

export interface ConnectorAuthContext {
  connection: EvidenceConnectionRecord;
  credential: EvidenceCredentialRecord;
  authMethod: EvidenceCredentialType;
  signatureVerified: boolean;
}

declare global {
  namespace Express {
    interface Request {
      evidenceConnector?: ConnectorAuthContext;
    }
  }
}

export {};
