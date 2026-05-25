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

const LINKABLE_EVIDENCE_TABLES = new Set([
  'evidence_communication',
  'evidence_appointments',
  'evidence_invoices',
  'evidence_service_access',
  'evidence_modules',
  'evidence_course_completion',
  'evidence_custom_events',
  'evidence_external_sessions',
  'evidence_sessions',
  'evidence_pulse_checkins',
  'evidence_milestones',
  'evidence_signoffs',
  'evidence_resource_delivery',
]);

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

    const shouldQueryExtraTable = (type: string) => !opts.type || opts.type === type;

    const extraTableQuery = (table: string, type: string) => {
      if (!shouldQueryExtraTable(type)) return Promise.resolve({ data: [] as any[] });
      let q: any = supabase
        .from(table)
        .select('*')
        .eq('location_id', locationId)
        .eq('contact_id', contactId);
      if (opts.from) q = q.gte('created_at', opts.from);
      if (opts.to) q = q.lte('created_at', opts.to);
      return safeQuery(() => q.order('created_at', { ascending: false }));
    };

    const [timelineResult, evidenceResult, appointmentResult, invoiceResult, communicationResult] = await Promise.all([
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
      extraTableQuery('evidence_appointments', 'appointment'),
      extraTableQuery('evidence_invoices', 'invoice'),
      extraTableQuery('evidence_communication', 'communication'),
    ]);

    if (timelineResult.error) throw timelineResult.error;

    const timelineRows = (timelineResult.data || [])
      .filter((row: any) => row.type !== 'communication')
      .map((row: any) => ({ ...row, evidence_table: row.evidence_table || null }));
    const evidenceRows = (evidenceResult.data as any[] || []).map((e: any) => ({
      ...e,
      type: e.evidence_type,
      source: 'scalesafe',
      evidence_table: 'evidence',
    }));
    const appointmentRows = (appointmentResult.data as any[] || []).map((e: any) => ({
      ...e,
      type: 'appointment',
      data: e,
      evidence_table: 'evidence_appointments',
    }));
    const invoiceRows = (invoiceResult.data as any[] || []).map((e: any) => ({
      ...e,
      type: 'invoice',
      data: e,
      evidence_table: 'evidence_invoices',
    }));
    const communicationRows = (communicationResult.data as any[] || []).map((e: any) => ({
      ...e,
      type: 'communication',
      data: e,
      evidence_table: 'evidence_communication',
    }));

    // Merge and deduplicate by id, sort newest first
    const allRows = [...timelineRows, ...evidenceRows, ...appointmentRows, ...invoiceRows, ...communicationRows];
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

    const [timelineCounts, evidenceCounts, appointmentCounts, invoiceCounts, communicationCounts] = await Promise.all([
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
      safeQuery(() => supabase
        .from('evidence_appointments')
        .select('id')
        .eq('location_id', locationId)
        .eq('contact_id', contactId)),
      safeQuery(() => supabase
        .from('evidence_invoices')
        .select('id')
        .eq('location_id', locationId)
        .eq('contact_id', contactId)),
      safeQuery(() => supabase
        .from('evidence_communication')
        .select('id')
        .eq('location_id', locationId)
        .eq('contact_id', contactId)),
    ]);

    if (timelineCounts.error) throw timelineCounts.error;

    const counts: Record<string, number> = {};
    for (const row of (timelineCounts.data || [])) {
      const t = row.type || 'unknown';
      if (t === 'communication') continue;
      counts[t] = (counts[t] || 0) + 1;
    }
    for (const row of (evidenceCounts.data as any[] || [])) {
      const t = row.evidence_type || 'unknown';
      counts[t] = (counts[t] || 0) + 1;
    }
    const appointmentCount = (appointmentCounts.data as any[] || []).length;
    if (appointmentCount > 0) counts.appointment = (counts.appointment || 0) + appointmentCount;
    const invoiceCount = (invoiceCounts.data as any[] || []).length;
    if (invoiceCount > 0) counts.invoice = (counts.invoice || 0) + invoiceCount;
    const communicationCount = (communicationCounts.data as any[] || []).length;
    if (communicationCount > 0) counts.communication = (counts.communication || 0) + communicationCount;
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

    const [timelineResult, evidenceResult, appointmentResult, invoiceResult, communicationResult] = await Promise.all([
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
      safeQuery(() => supabase
        .from('evidence_appointments')
        .select('created_at')
        .eq('location_id', locationId)
        .eq('contact_id', contactId)
        .order('created_at', { ascending: false })
        .limit(1)
        .single()),
      safeQuery(() => supabase
        .from('evidence_invoices')
        .select('created_at')
        .eq('location_id', locationId)
        .eq('contact_id', contactId)
        .order('created_at', { ascending: false })
        .limit(1)
        .single()),
      safeQuery(() => supabase
        .from('evidence_communication')
        .select('created_at')
        .eq('location_id', locationId)
        .eq('contact_id', contactId)
        .order('created_at', { ascending: false })
        .limit(1)
        .single()),
    ]);

    const dates = [
      (timelineResult.error?.code === 'PGRST116') ? null : timelineResult.data?.created_at || null,
      (evidenceResult.data as any)?.created_at || null,
      (appointmentResult.data as any)?.created_at || null,
      (invoiceResult.data as any)?.created_at || null,
      (communicationResult.data as any)?.created_at || null,
    ].filter(Boolean) as string[];

    if (timelineResult.error && timelineResult.error.code !== 'PGRST116') throw timelineResult.error;

    return dates.sort().pop() || null;
  },

  async linkToEnrollment(
    locationId: string,
    contactId: string,
    evidenceTable: string,
    evidenceId: string,
    enrollmentId: string,
  ): Promise<void> {
    if (!LINKABLE_EVIDENCE_TABLES.has(evidenceTable)) {
      throw new Error('Evidence type cannot be linked to a program');
    }

    const supabase = getSupabase();
    const { data: enrollment, error: enrollmentError } = await supabase
      .from('enrollments')
      .select('id')
      .eq('location_id', locationId)
      .eq('contact_id', contactId)
      .eq('id', enrollmentId)
      .maybeSingle();

    if (enrollmentError && enrollmentError.code !== 'PGRST116') throw enrollmentError;
    if (!enrollment) throw new Error('Program enrollment not found for this client');

    const { error } = await supabase
      .from(evidenceTable)
      .update({ enrollment_id: enrollmentId })
      .eq('location_id', locationId)
      .eq('contact_id', contactId)
      .eq('id', evidenceId);

    if (error) throw error;
  },
};
