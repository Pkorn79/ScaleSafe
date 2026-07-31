import { getSupabase } from '../clients/supabase.client';
import {
  GuardianAlertDelivery,
  GuardianAuthentication,
  GuardianClaimResult,
  GuardianCredential,
  GuardianRecoveryVerification,
  GuardianRun,
} from '../types/guardian';

interface SnapshotHealthRow {
  scope_type: string;
  check_key: string;
  state: string;
  severity: string | null;
  metrics: Record<string, unknown> | null;
  last_observed_at: string;
}

function firstRow<T>(value: unknown): T | null {
  if (Array.isArray(value)) return (value[0] as T | undefined) || null;
  return (value as T | null) || null;
}

function decodePublicKey(value: unknown): Buffer {
  if (Buffer.isBuffer(value)) {
    if (value.length !== 32) throw new Error('Guardian public key has an invalid length');
    return Buffer.from(value);
  }
  if (value instanceof Uint8Array) {
    const decoded = Buffer.from(value);
    if (decoded.length !== 32) throw new Error('Guardian public key has an invalid length');
    return decoded;
  }
  if (typeof value !== 'string') {
    throw new Error('Guardian public key is unavailable');
  }

  const decoded = value.startsWith('\\x')
    ? Buffer.from(value.slice(2), 'hex')
    : /^[a-f0-9]{64}$/i.test(value)
      ? Buffer.from(value, 'hex')
      : Buffer.from(value, 'base64');
  if (decoded.length !== 32) throw new Error('Guardian public key has an invalid length');
  return decoded;
}

function mapCredential(row: any): GuardianCredential {
  return {
    id: String(row.id),
    keyId: String(row.key_id),
    instanceId: String(row.instance_id),
    publicKey: decodePublicKey(row.public_key),
    status: row.status,
    validFrom: String(row.valid_from),
    validUntil: row.valid_until ? String(row.valid_until) : null,
  };
}

export const guardianRepository = {
  async getCredentialByKeyId(keyId: string): Promise<GuardianCredential | null> {
    const { data, error } = await getSupabase()
      .from('guardian_credentials')
      .select('id,key_id,instance_id,public_key,status,valid_from,valid_until')
      .eq('key_id', keyId)
      .maybeSingle();
    if (error) throw error;
    return data ? mapCredential(data) : null;
  },

  async hasActiveSnapshotCredential(now = new Date()): Promise<boolean> {
    const iso = now.toISOString();
    const { data, error } = await getSupabase()
      .from('guardian_credentials')
      .select('id,valid_until')
      .in('status', ['active', 'overlap'])
      .lte('valid_from', iso)
      .limit(100);
    if (error) throw error;

    const activeIds = (data || [])
      .filter((row: any) => !row.valid_until || new Date(row.valid_until).getTime() > now.getTime())
      .map((row: any) => String(row.id));
    if (activeIds.length === 0) return false;

    const { data: grants, error: grantError } = await getSupabase()
      .from('guardian_credential_check_keys')
      .select('guardian_credential_id')
      .in('guardian_credential_id', activeIds)
      .eq('check_key', 'platform.snapshot.freshness')
      .eq('active', true)
      .limit(1);
    if (grantError) throw grantError;
    return Boolean(grants?.length);
  },

  async claimRequest(input: {
    authentication: GuardianAuthentication;
    payload: GuardianRun | GuardianRecoveryVerification | GuardianAlertDelivery | null;
  }): Promise<GuardianClaimResult> {
    const { authentication } = input;
    const requestTimestamp = new Date(
      Number(authentication.timestampSeconds) * 1000,
    ).toISOString();
    const { data, error } = await getSupabase().rpc('claim_guardian_request', {
      p_key_id: authentication.credential.keyId,
      p_sequence: authentication.sequence,
      p_protocol_version: 1,
      p_endpoint_path: authentication.exactPath,
      p_http_method: authentication.method,
      p_request_timestamp: requestTimestamp,
      p_body_sha256: authentication.bodySha256,
      p_payload: input.payload,
    });
    if (error) throw error;

    const row = firstRow<any>(data);
    if (!row) throw new Error('Guardian claim returned no decision');
    return {
      decision: row.decision,
      receiptId: row.receipt_id || null,
      originalReceiptId: row.original_receipt_id || null,
      acceptedSequence:
        row.accepted_sequence === null || row.accepted_sequence === undefined
          ? null
          : String(row.accepted_sequence),
      acceptedObservationCount: Number(row.accepted_observation_count || 0),
      recordId: row.record_id || null,
      rejectionCode: row.rejection_code || null,
      serverTime: new Date(row.server_time).toISOString(),
    };
  },

  async getSnapshotInputs(): Promise<{
    schemaVersion: number;
    healthRows: SnapshotHealthRow[];
    openIncidents: {
      info: number;
      warning: number;
      urgent: number;
      critical: number;
    };
  }> {
    const { data: version, error: versionError } = await getSupabase()
      .rpc('scalesafe_schema_version');
    if (versionError) throw versionError;

    const { data: healthRows, error: healthError } = await getSupabase()
      .from('health_current')
      .select('scope_type,check_key,state,severity,metrics,last_observed_at')
      .is('location_id', null)
      .in('scope_type', ['platform', 'worker', 'job', 'queue'])
      .limit(500);
    if (healthError) throw healthError;

    const counts = {
      info: 0,
      warning: 0,
      urgent: 0,
      critical: 0,
    };
    for (const severity of Object.keys(counts) as Array<keyof typeof counts>) {
      const { count, error } = await getSupabase()
        .from('platform_incidents')
        .select('id', { count: 'exact', head: true })
        .eq('severity', severity)
        .neq('status', 'resolved');
      if (error) throw error;
      counts[severity] = Number(count || 0);
    }

    return {
      schemaVersion: Number(version),
      healthRows: (healthRows || []) as SnapshotHealthRow[],
      openIncidents: counts,
    };
  },
};
