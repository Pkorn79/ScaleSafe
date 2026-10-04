/**
 * Deterministic, in-memory PostgREST boundary for install integration tests.
 * Application repositories are real. This models row versions and uniqueness;
 * it is NOT a substitute for PostgreSQL isolation/trigger certification.
 */
export class InstallStore {
  tables = new Map<string, any[]>();
  beforeMerchantWrite: (() => Promise<void>) | null = null;
  private version = 0;

  reset() {
    this.tables.clear();
    this.version = 0;
    this.beforeMerchantWrite = null;
  }

  rows(table: string): any[] {
    if (!this.tables.has(table)) this.tables.set(table, []);
    return this.tables.get(table)!;
  }

  merchant(location: string): any {
    const row = this.rows('merchants').find((item) => item.location_id === location);
    return row ? JSON.parse(JSON.stringify(row)) : null;
  }

  from(table: string): any {
    if (!['merchants', 'idempotency_keys', 'marketplace_entitlement_events'].includes(table)) {
      throw new Error('Unexpected database table in isolated install test: ' + table);
    }
    let operation = 'select';
    let patch: any;
    let single = false;
    let optional = false;
    const filters: Array<[string, unknown]> = [];
    let execution: Promise<any> | null = null;
    const run = async () => {
      if (operation !== 'select' && table === 'merchants' && this.beforeMerchantWrite) {
        const barrier = this.beforeMerchantWrite;
        this.beforeMerchantWrite = null;
        await barrier();
      }
      const rows = this.rows(table);
      const matches = rows.filter((row) => filters.every(([key, value]) => row[key] === value));
      let result = matches;
      if (operation === 'insert' || operation === 'upsert') {
        const duplicate = rows.find((row) => table === 'merchants'
          ? row.location_id === patch.location_id
          : table === 'marketplace_entitlement_events'
            ? row.event_key === patch.event_key
            : row.event_id === patch.event_id && row.source === patch.source && row.location_id === patch.location_id);
        if (duplicate && operation === 'insert') return { data: null, error: { code: '23505' } };
        if (duplicate) result = [duplicate];
        else {
          const row = {
            ...(table === 'merchants' ? {
              status: 'active', snapshot_status: 'pending', snapshot_attempts: 0, config: {},
              marketplace_plan_key: 'legacy', marketplace_billing_status: 'unknown',
            } : {}),
            id: 'fictional-row-' + (++this.version),
            ...patch,
            updated_at: new Date(1_800_000_000_000 + this.version).toISOString(),
          };
          rows.push(row);
          result = [row];
        }
      } else if (operation === 'update') {
        for (const row of matches) {
          Object.assign(row, patch, {
            updated_at: new Date(1_800_000_000_000 + (++this.version)).toISOString(),
          });
        }
      }
      if (single && result.length !== 1) {
        return { data: null, error: optional && result.length === 0 ? null : { code: 'PGRST116' } };
      }
      return { data: JSON.parse(JSON.stringify(single ? result[0] : result)), error: null };
    };
    const builder: any = {
      select: () => builder,
      eq: (key: string, value: unknown) => { filters.push([key, value]); return builder; },
      insert: (value: any) => { operation = 'insert'; patch = value; return builder; },
      upsert: (value: any) => { operation = 'upsert'; patch = value; return builder; },
      update: (value: any) => { operation = 'update'; patch = value; return builder; },
      single: () => { single = true; return builder; },
      maybeSingle: () => { single = true; optional = true; return builder; },
      then: (resolve: any, reject: any) => {
        execution ||= run();
        return execution.then(resolve, reject);
      },
    };
    return builder;
  }
}

export function barrier() {
  let enter!: () => void;
  let release!: () => void;
  const entered = new Promise<void>((resolve) => { enter = resolve; });
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  return { entered, release, wait: async () => { enter(); await blocked; } };
}
