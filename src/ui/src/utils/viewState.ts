export function getDefensePacketExhibits(packet: any): any[] {
  const snapshot = packet?.evidence_snapshot || packet?.evidenceSnapshot;
  return Array.isArray(snapshot?.exhibits) ? snapshot.exhibits : [];
}

export function getDefensePacketExhibitState(packet: any): {
  exhibits: any[];
  reportedCount: number;
  legacySnapshot: boolean;
} {
  const snapshot = packet?.evidence_snapshot || packet?.evidenceSnapshot;
  const exhibits = getDefensePacketExhibits(packet);
  const storedCount = Number(packet?.evidence_count ?? packet?.evidenceCount);
  const reportedCount = Number.isFinite(storedCount) && storedCount >= 0
    ? Math.max(storedCount, exhibits.length)
    : exhibits.length;

  return {
    exhibits,
    reportedCount,
    legacySnapshot: Array.isArray(snapshot) && exhibits.length === 0 && reportedCount > 0,
  };
}

export function normalizeStripeHealthStatus(
  value: unknown,
  allowed: readonly string[],
  trusted = true,
): string {
  if (!trusted) return 'unknown';
  const normalized = String(value || '').trim().toLowerCase();
  return allowed.includes(normalized) ? normalized : 'unknown';
}

export function buildMerchantSettingsPayload(config: any, thresholds: any) {
  return {
    businessName: config?.businessName,
    dbaName: config?.dbaName,
    supportEmail: config?.supportEmail,
    descriptor: config?.descriptor,
    businessWebsite: config?.businessWebsite,
    businessCity: config?.businessCity,
    businessState: config?.businessState,
    industryNiche: config?.industryNiche,
    primaryServiceType: config?.primaryServiceType,
    logoUrl: config?.logoUrl,
    shortDescription: config?.shortDescription,
    enrollmentFunnelUrl: config?.enrollmentFunnelUrl,
    modules: { ...(config?.modules || {}) },
    dunningEnabled: config?.dunningEnabled,
    dunningMaxRetries: config?.dunningMaxRetries,
    engagementEnabled: config?.engagementEnabled,
    config: {
      disengagement_thresholds: { ...(thresholds || {}) },
    },
  };
}

export function cloneViewState<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}
