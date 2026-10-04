export const LOCATION_IDENTITY_TTL_MS = 24 * 60 * 60 * 1000;
export const LOCATION_IDENTITY_SOURCE = 'ghl_location_api' as const;

export interface LocationIdentityRecord {
  ghl_location_name?: string | null;
  ghl_location_name_source?: string | null;
  ghl_location_name_verified_at?: string | null;
  ghl_location_name_checked_at?: string | null;
  ghl_location_name_error?: string | null;
  ghl_location_name_refresh_id?: string | null;
  ghl_identity_authorized?: boolean;
}

export interface LocationIdentity {
  name: string | null;
  displayName: string;
  status: 'verified' | 'stale' | 'unavailable';
  authorization: 'authorized' | 'incomplete';
  source: string | null;
  verifiedAt: string | null;
  checkedAt: string | null;
  reason: string | null;
}

// This projection deliberately has no business/agency-name fallback.
export function projectLocationIdentity(row: LocationIdentityRecord, now = Date.now()): LocationIdentity {
  const authorized = row.ghl_identity_authorized === true && row.ghl_location_name_error !== 'authorization_incomplete';
  const verifiedAt = row.ghl_location_name_verified_at || null;
  const verifiedTime = Date.parse(verifiedAt || '');
  const hasProof = row.ghl_location_name_source === LOCATION_IDENTITY_SOURCE
    && Boolean(row.ghl_location_name?.trim()) && Number.isFinite(verifiedTime) && verifiedTime <= now;
  const name = hasProof ? row.ghl_location_name! : null;
  const reason = !authorized ? 'authorization_incomplete' : row.ghl_location_name_error || (!hasProof ? 'not_verified' : null);
  const status = !authorized || !hasProof ? 'unavailable'
    : reason || now - verifiedTime >= LOCATION_IDENTITY_TTL_MS ? 'stale' : 'verified';
  return {
    name, status, authorization: authorized ? 'authorized' : 'incomplete',
    displayName: !authorized ? 'HighLevel name unavailable \u2014 authorization incomplete'
      : name || 'HighLevel name unavailable',
    source: hasProof ? LOCATION_IDENTITY_SOURCE : null,
    verifiedAt: hasProof ? verifiedAt : null,
    checkedAt: row.ghl_location_name_checked_at || null,
    reason,
  };
}

export const LOCATION_IDENTITY_COLUMNS = 'ghl_location_name,ghl_location_name_source,ghl_location_name_verified_at,ghl_location_name_checked_at,ghl_location_name_error,ghl_identity_authorized';
