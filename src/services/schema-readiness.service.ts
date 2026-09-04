import { getSupabase } from '../clients/supabase.client';
import { config } from '../config';

export const BASE_REQUIRED_SCHEMA_VERSION = 103;
export const COMMAND_CENTER_HEALTH_SCHEMA_VERSION = 104;
export const GUARDIAN_SCHEMA_VERSION = 105;

function requiredSchemaVersion(): number {
  if (config.guardian.enabled) return GUARDIAN_SCHEMA_VERSION;
  return config.operator.healthEnabled
    ? COMMAND_CENTER_HEALTH_SCHEMA_VERSION
    : BASE_REQUIRED_SCHEMA_VERSION;
}

export const schemaReadinessService = {
  async check(): Promise<{ ready: boolean; version: number | null; error?: string }> {
    try {
      const { data, error } = await getSupabase().rpc('scalesafe_schema_version');
      if (error) {
        return { ready: false, version: null, error: error.message || 'Schema version check failed' };
      }
      const version = Number(data);
      const requiredVersion = requiredSchemaVersion();
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
