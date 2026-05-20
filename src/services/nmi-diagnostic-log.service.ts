import { getSupabase } from '../clients/supabase.client';
import { logger } from '../utils/logger';

function isColumnCompatibilityError(error: any): boolean {
  const text = [
    error?.code,
    error?.message,
    error?.details,
    error?.hint,
  ].filter(Boolean).join(' ').toLowerCase();

  return text.includes('pgrst204')
    || text.includes('schema cache')
    || text.includes('could not find')
    || text.includes('does not exist');
}

function stripNewDiagnosticFields(fields: Record<string, unknown>): Record<string, unknown> {
  const { payment_event_id: _paymentEventId, ...fallback } = fields;
  return fallback;
}

export const nmiDiagnosticLogService = {
  async create(fields: Record<string, unknown>): Promise<string | null> {
    const supabase = getSupabase();
    try {
      let response = await supabase
        .from('nmi_silent_post_logs')
        .insert(fields)
        .select('id')
        .single();

      if (response.error && isColumnCompatibilityError(response.error) && 'payment_event_id' in fields) {
        response = await supabase
          .from('nmi_silent_post_logs')
          .insert(stripNewDiagnosticFields(fields))
          .select('id')
          .single();
      }

      if (response.error) throw response.error;
      return response.data?.id || null;
    } catch (err: any) {
      logger.debug({ err: err.message }, 'NMI diagnostic insert skipped');
      return null;
    }
  },

  async update(logId: string | null, fields: Record<string, unknown>): Promise<void> {
    if (!logId) return;
    const supabase = getSupabase();
    try {
      let response = await supabase
        .from('nmi_silent_post_logs')
        .update(fields)
        .eq('id', logId);

      if (response.error && isColumnCompatibilityError(response.error) && 'payment_event_id' in fields) {
        response = await supabase
          .from('nmi_silent_post_logs')
          .update(stripNewDiagnosticFields(fields))
          .eq('id', logId);
      }

      if (response.error) throw response.error;
    } catch (err: any) {
      logger.debug({ err: err.message, logId }, 'NMI diagnostic update skipped');
    }
  },
};
