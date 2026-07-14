import { getSupabase } from '../clients/supabase.client';

const REQUIRED_SCHEMA_VERSION = 99;

export const schemaReadinessService = {
  async check(): Promise<{ ready: boolean; version: number | null; error?: string }> {
    try {
      const { data, error } = await getSupabase().rpc('scalesafe_schema_version');
      if (error) {
        return { ready: false, version: null, error: error.message || 'Schema version check failed' };
      }
      const version = Number(data);
      return {
        ready: Number.isInteger(version) && version >= REQUIRED_SCHEMA_VERSION,
        version: Number.isFinite(version) ? version : null,
        ...(!Number.isInteger(version) || version < REQUIRED_SCHEMA_VERSION
          ? { error: `Schema version ${Number.isFinite(version) ? version : 'unknown'} is below required version ${REQUIRED_SCHEMA_VERSION}` }
          : {}),
      };
    } catch (err: any) {
      return { ready: false, version: null, error: err?.message || String(err) };
    }
  },

  async assertReady(): Promise<void> {
    const result = await this.check();
    if (!result.ready) {
      throw new Error(`ScaleSafe database is not deployment-ready: ${result.error || 'migration 099 is missing'}`);
    }
  },
};
