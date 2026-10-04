import crypto from 'crypto';
import { ghlApi } from '../clients/ghl.client';
import { MerchantRecord, merchantRepository } from '../repositories/merchant.repository';
import { LOCATION_IDENTITY_SOURCE, LOCATION_IDENTITY_TTL_MS } from '../utils/merchant-location-identity';
import { logger } from '../utils/logger';

const inFlight = new Map<string, Promise<void>>();
const RETRY_MS = 5 * 60 * 1000;

export function identityAuthorizationBound(row: MerchantRecord): boolean {
  const config = row.config || {};
  const companyMatches = !config.ghl_token_company_id || config.ghl_token_company_id === row.company_id;
  return row.status === 'active'
    && Boolean(row.ghl_access_token_encrypted || row.ghl_access_token)
    && Boolean(row.ghl_refresh_token_encrypted || row.ghl_refresh_token)
    && (row.ghl_scopes || '').split(/\s+/).includes('locations.readonly')
    && companyMatches
    && (config.ghl_token_scope === 'location' && config.ghl_token_location_id === row.location_id
      || config.ghl_token_scope === 'company' && Boolean(row.company_id) && config.ghl_token_company_id === row.company_id);
}

function authorizationGeneration(row: MerchantRecord): string {
  return JSON.stringify([row.status, row.company_id, row.config?.ghl_token_scope,
    row.config?.ghl_token_company_id, row.config?.ghl_token_location_id, row.config?.ghl_oauth_connected_at,
    identityAuthorizationBound(row)]);
}

async function refresh(locationId: string, force: boolean): Promise<void> {
  const row = await merchantRepository.getByLocationId(locationId);
  const lastCheck = Date.parse(row.ghl_location_name_checked_at || '');
  const lastProof = Date.parse(row.ghl_location_name_verified_at || '');
  if (!force && Date.now() - lastCheck < RETRY_MS) return;
  if (!force && !row.ghl_location_name_error && identityAuthorizationBound(row)
    && row.ghl_location_name_source === LOCATION_IDENTITY_SOURCE && row.ghl_location_name
    && Date.now() - lastProof >= 0 && Date.now() - lastProof < LOCATION_IDENTITY_TTL_MS) return;

  const refreshId = crypto.randomUUID();
  const checkedAt = new Date().toISOString();
  if (!await merchantRepository.writeLocationIdentity(row, {
    ghl_location_name_checked_at: checkedAt, ghl_location_name_refresh_id: refreshId,
  })) return;

  let failure: string | null = null;
  let name: string | null = null;
  if (!identityAuthorizationBound(row)) {
    failure = 'authorization_incomplete';
  } else {
    try {
      // ghlApi exchanges company credentials for this exact location; never use
      // an agency profile or an installed-locations display name as proof.
      const api = await ghlApi(locationId);
      const response = await api.get(`/locations/${encodeURIComponent(locationId)}`);
      const location = response.data?.location;
      if (location?.id !== locationId
        || location?.companyId && row.company_id && location.companyId !== row.company_id) {
        failure = 'identity_mismatch';
      } else if (typeof location.name !== 'string' || !location.name.trim() || location.name.length > 500) {
        failure = 'invalid_response';
      } else {
        name = location.name.trim();
      }
    } catch (error: any) {
      const status = error?.ghlStatus || error?.response?.status || error?.statusCode;
      failure = [401, 403].includes(status) ? 'authorization_incomplete' : 'provider_unavailable';
      // Never persist/log provider errors: they may include credential headers.
    }
  }

  const current = await merchantRepository.getByLocationId(locationId);
  if (current.ghl_location_name_refresh_id !== refreshId || authorizationGeneration(current) !== authorizationGeneration(row)) return;
  await merchantRepository.writeLocationIdentity(current, {
    ghl_location_name_error: failure,
    ghl_location_name_refresh_id: null,
    ...(name ? { ghl_location_name: name, ghl_location_name_source: LOCATION_IDENTITY_SOURCE,
      ghl_location_name_verified_at: new Date().toISOString() } : {}),
  });
}

export const merchantLocationIdentityService = {
  refresh(locationId: string, force = false): Promise<void> {
    const pending = inFlight.get(locationId);
    if (pending) return force ? pending.catch(() => undefined).then(() => this.refresh(locationId, true)) : pending;
    const work = refresh(locationId, force).finally(() => inFlight.delete(locationId));
    inFlight.set(locationId, work);
    return work;
  },
  schedule(locationId: string, force = false): void {
    void this.refresh(locationId, force).catch(() => {
      logger.warn({ locationId }, 'HighLevel identity lookup could not be recorded');
    });
  },
};
