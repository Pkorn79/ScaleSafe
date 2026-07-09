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
