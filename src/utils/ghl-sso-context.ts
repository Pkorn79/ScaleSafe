import { AuthenticationError } from './errors';

type SsoPayload = Record<string, unknown>;

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function firstText(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value !== 'string' && typeof value !== 'number') continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return '';
}

function extractId(value: unknown): string {
  const direct = firstText(value);
  if (direct) return direct;

  const obj = asObject(value);
  if (!obj) return '';

  return firstText(
    obj.id,
    obj._id,
    obj.locationId,
    obj.location_id,
    obj.companyId,
    obj.company_id,
  );
}

export function extractGhlSsoContext(userData: SsoPayload): {
  locationId: string;
  companyId: string;
  userId: string;
  email: string;
  role: string;
  userName: string;
} {
  return {
    locationId: firstText(
      extractId(userData.activeLocation),
      extractId(userData.active_location),
      extractId(userData.selectedLocation),
      extractId(userData.selected_location),
      extractId(userData.location),
      extractId(userData.locationId),
      extractId(userData.location_id),
    ),
    companyId: firstText(
      extractId(userData.company),
      extractId(userData.companyId),
      extractId(userData.company_id),
    ),
    userId: firstText(userData.userId, userData.user_id),
    email: firstText(userData.email),
    role: firstText(userData.role) || 'user',
    userName: firstText(userData.userName, userData.name),
  };
}

export function assertActiveGhlMerchantBinding(
  merchant: Record<string, any> | null | undefined,
  context: { locationId: string; companyId?: string },
): void {
  if (!merchant) {
    throw new AuthenticationError('Merchant not found for this ScaleSafe install.');
  }
  if (merchant.location_id !== context.locationId) {
    throw new AuthenticationError('ScaleSafe merchant does not match the GHL sub-account.');
  }
  if (merchant.status !== 'active') {
    throw new AuthenticationError('ScaleSafe is not actively installed for this sub-account.');
  }
  if (context.companyId && merchant.company_id && context.companyId !== merchant.company_id) {
    throw new AuthenticationError('ScaleSafe installation does not match the GHL agency.');
  }

  const config = (merchant.config || {}) as Record<string, unknown>;
  const tokenScope = String(config.ghl_token_scope || '').toLowerCase();
  const tokenLocationId = String(config.ghl_token_location_id || '').trim();
  const tokenCompanyId = String(config.ghl_token_company_id || '').trim();
  if (tokenScope === 'location' && tokenLocationId && tokenLocationId !== context.locationId) {
    throw new AuthenticationError('Stored GHL authorization belongs to a different sub-account.');
  }
  if (tokenScope === 'company' && tokenCompanyId && context.companyId && tokenCompanyId !== context.companyId) {
    throw new AuthenticationError('Stored GHL authorization belongs to a different agency.');
  }

  const hasAccessToken = Boolean(merchant.ghl_access_token_encrypted || merchant.ghl_access_token);
  const hasRefreshToken = Boolean(merchant.ghl_refresh_token_encrypted || merchant.ghl_refresh_token);
  if (!hasAccessToken || !hasRefreshToken) {
    throw new AuthenticationError(
      'ScaleSafe installation is waiting for GoHighLevel authorization. Reinstall the app in this sub-account.',
    );
  }
}
