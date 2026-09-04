import { getSupabase } from '../clients/supabase.client';
import { config } from '../config';

// Migration 111 is a core Stripe webhook integrity dependency and is not
// feature-gated. The candidate must never run before the full 106 -> 111
// migration-first rollout has completed.
export const BASE_REQUIRED_SCHEMA_VERSION = 111;
export const OPERATOR_IDENTITY_SCHEMA_VERSION = 107;
export const COMMAND_CENTER_HEALTH_SCHEMA_VERSION = 108;
export const GUARDIAN_SCHEMA_VERSION = 109;
export const OPERATOR_DASHBOARD_SCHEMA_VERSION = 110;
export const CURRENT_RELEASE_SCHEMA_VERSION = 111;

function requiredSchemaVersion(): number {
  if (config.operator.enabled) return Math.max(BASE_REQUIRED_SCHEMA_VERSION, OPERATOR_DASHBOARD_SCHEMA_VERSION);
  if (config.guardian.enabled) return Math.max(BASE_REQUIRED_SCHEMA_VERSION, GUARDIAN_SCHEMA_VERSION);
  if (config.operator.healthEnabled) return Math.max(BASE_REQUIRED_SCHEMA_VERSION, COMMAND_CENTER_HEALTH_SCHEMA_VERSION);
  if (config.operator.authEnabled) return Math.max(BASE_REQUIRED_SCHEMA_VERSION, OPERATOR_IDENTITY_SCHEMA_VERSION);
  return BASE_REQUIRED_SCHEMA_VERSION;
}

export const schemaReadinessService = {
  requiredVersion(): number {
    return requiredSchemaVersion();
  },

  maximumSupportedVersion(): number {
    return CURRENT_RELEASE_SCHEMA_VERSION;
  },

  async check(): Promise<{ ready: boolean; version: number | null; error?: string }> {
    try {
      const { data, error } = await getSupabase().rpc('scalesafe_schema_version');
      if (error) {
        return { ready: false, version: null, error: error.message || 'Schema version check failed' };
      }
      const version = Number(data);
      const requiredVersion = this.requiredVersion();
      return {
        ready: Number.isInteger(version) && version >= requiredVersion,
        version: Number.isFinite(version) ? version : null,
        ...(!Number.isInteger(version) || version < requiredVersion
          ? { error: `Schema version ${Number.isFinite(version) ? version : 'unknown'} is below required version ${requiredVersion}` }
          : {}),
      };
    } catch (err: any) {
      return { ready: false, version: null, error: err?.message || String(err) };
    }
  },

  async assertReady(): Promise<void> {
    const result = await this.check();
    if (!result.ready) {
      throw new Error(`ScaleSafe database is not deployment-ready: ${result.error || 'required migration is missing'}`);
    }
  },
};
