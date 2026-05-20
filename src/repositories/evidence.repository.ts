import { getSupabase } from '../clients/supabase.client';
import { EVIDENCE_TABLE_MAP, EvidenceType } from '../constants/evidence-types';
import { DefenseEvidenceFields } from '../types/defense-evidence.types';

export interface EvidenceInsert extends DefenseEvidenceFields {
  location_id: string;
  contact_id: string;
  source: string;
  [key: string]: unknown;
}

// Safe query helper — returns { data: null } if table doesn't exist
async function safeQuery<T>(fn: () => PromiseLike<{ data: T | null; error: any }>): Promise<{ data: T | null }> {
  try {
    const result = await fn();
    if (result.error) return { data: null };
    return { data: result.data };
  } catch {
    return { data: null };
  }
}

export const evidenceRepository = {
  /**
   * Insert a record into the appropriate evidence table.
   */
  async insert(evidenceType: EvidenceType, record: EvidenceInsert): Promise<void> {
    const table = EVIDENCE_TABLE_MAP[evidenceType];
    if (!table) throw new Error(`Unknown evidence type: ${evidenceType}`);

    const { error } = await getSupabase().from(table).insert(record);
    if (error) throw error;
  },

  /**
   * Get the unified evidence timeline for a contact.
   * Queries both evidence_timeline view and evidence table, merges and deduplicates.
   *
   * Optional filters:
   *   - type: evidence type (e.g., 'consent', 'session', 'milestone')
   *   - from / to: ISO date strings (inclusive)
   *   - limit / offset: pagination
   */
  async getTimeline(
    locationId: string,
    contactId: string,
    opts: { limit?: number; offset?: number; type?: string; from?: string; to?: string } = {},
  ): Promise<{ rows: any[]; total: number }> {
    const supabase = getSupabase();
    const limit = opts.limit ?? 100;
    const offset = opts.offset ?? 0;

    // Build filter clauses common to both sources
    const applyFilters = (q: any, typeField: 'type' | 'evidence_type') => {
      let out = q.eq('location_id', locationId).eq('contact_id', contactId);
      if (opts.type) out = out.eq(typeField, opts.type);
      if (opts.from) out = out.gte('created_at', opts.from);
      if (opts.to) out = out.lte('created_at', opts.to);
      return out;
    };

    const [timelineResult, evidenceResult] = await Promise.all([
      applyFilters(
        supabase.from('evidence_timeline').select('*'),
        'type',
      ).order('created_at', { ascending: false }),
      safeQuery(() =>
        applyFilters(
          supabase.from('evidence').select('*'),
          'evidence_type',
        ).order('created_at', { ascending: false }),
      ),
    ]);

    if (timelineResult.error) throw timelineResult.error;

    const timelineRows = timelineResult.data || [];
    const evidenceRows = (evidenceResult.data as any[] || []).map((e: any) => ({
      ...e,
      type: e.evidence_type,
      source: 'scalesafe',
    }));

    // Merge and deduplicate by id, sort newest first
    const allRows = [...timelineRows, ...evidenceRows];
    const seen = new Set<string>();
    const unique = allRows.filter(r => {
      if (r.id && seen.has(r.id)) return false;
      if (r.id) seen.add(r.id);
      return true;
    });

    unique.sort((a, b) => {
      const dateA = new Date(a.created_at || 0).getTime();
      const dateB = new Date(b.created_at || 0).getTime();
      return dateB - dateA;
    });

    return {
      rows: unique.slice(offset, offset + limit),
      total: unique.length,
    };
  },

  /**
   * Get evidence counts per type for a contact (for readiness scoring).
   */
  async getCounts(locationId: string, contactId: string): Promise<Record<string, number>> {
    const supabase = getSupabase();

    const [timelineCounts, evidenceCounts] = await Promise.all([
      supabase
        .from('evidence_timeline')
        .select('type')
        .eq('location_id', locationId)
        .eq('contact_id', contactId),
      safeQuery(() => supabase
        .from('evidence')
        .select('evidence_type')
        .eq('location_id', locationId)
        .eq('contact_id', contactId)),
    ]);

    if (timelineCounts.error) throw timelineCounts.error;

    const counts: Record<string, number> = {};
    for (const row of (timelineCounts.data || [])) {
      const t = row.type || 'unknown';
      counts[t] = (counts[t] || 0) + 1;
    }
    for (const row of (evidenceCounts.data as any[] || [])) {
      const t = row.evidence_type || 'unknown';
      counts[t] = (counts[t] || 0) + 1;
    }
    return counts;
  },

  /**
   * Get all evidence for a contact as a snapshot (used for defense compilation).
   */
  async getFullSnapshot(locationId: string, contactId: string): Promise<any[]> {
    const { rows } = await this.getTimeline(locationId, contactId, { limit: 10000 });
    return rows;
  },

  /**
   * Get the most recent evidence date for a contact.
   */
  async getLastEvidenceDate(locationId: string, contactId: string): Promise<string | null> {
    const supabase = getSupabase();

    const [timelineResult, evidenceResult] = await Promise.all([
      supabase
        .from('evidence_timeline')
        .select('created_at')
        .eq('location_id', locationId)
        .eq('contact_id', contactId)
        .order('created_at', { ascending: false })
        .limit(1)
        .single(),
      safeQuery(() => supabase
        .from('evidence')
        .select('created_at')
        .eq('location_id', locationId)
        .eq('contact_id', contactId)
        .order('created_at', { ascending: false })
        .limit(1)
        .single()),
    ]);

    const timelineDate = (timelineResult.error?.code === 'PGRST116') ? null : timelineResult.data?.created_at || null;
    const evidenceDate = (evidenceResult.data as any)?.created_at || null;

    if (timelineResult.error && timelineResult.error.code !== 'PGRST116') throw timelineResult.error;

    // Return the most recent date from either source
    if (!timelineDate) return evidenceDate;
    if (!evidenceDate) return timelineDate;
    return timelineDate > evidenceDate ? timelineDate : evidenceDate;
  },
};
