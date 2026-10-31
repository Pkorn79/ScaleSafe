import { getSupabase } from '../clients/supabase.client';
import { commandCenterHealthRepository } from '../repositories/command-center-health.repository';
import { billingSetupAlert } from '../utils/billing-setup-alert';
import { logger } from '../utils/logger';

const CHECK = 'merchant.recurring_setup';
const PAGE = 200;

export const billingSetupHealthService = {
  async checkLocation(locationId: string, merchantId: string): Promise<void> {
    const alerts: Array<{ id: string; escalated: boolean; uncertain: boolean }> = [];
    for (let offset = 0; ; offset += PAGE) {
      const { data, error } = await getSupabase().from('enrollments')
        .select('id,status,payment_type,payments_total,payments_made,billing_completed_at,billing_setup_status,processor_subscription_id,enrolled_at,created_at')
        .eq('location_id', locationId).in('billing_setup_status', ['failed', 'pending', 'needs_reconciliation'])
        .order('id').range(offset, offset + PAGE - 1);
      if (error) throw error; // A failed read must never resolve an existing incident.
      for (const row of data || []) {
        const alert = billingSetupAlert(row);
        if (alert) alerts.push({ id: row.id, escalated: alert.escalated, uncertain: alert.uncertain });
      }
      if ((data || []).length < PAGE) break;
    }
    const escalated = alerts.filter(a => a.escalated).length;
    await commandCenterHealthRepository.recordObservation({
      scopeType: 'merchant', scopeId: locationId, locationId, merchantId, checkKey: CHECK,
      state: alerts.length ? 'unhealthy' : 'healthy',
      severity: alerts.length ? (escalated ? 'critical' : 'urgent') : null,
      failureClass: alerts.length ? 'RECURRING_SETUP_UNRESOLVED' : null,
      summary: alerts.length
        ? `${alerts.length} recurring billing setup(s) unresolved; ${escalated} require escalation. Verify processor schedules before any new charge or subscription.`
        : 'No unresolved recurring billing setups.',
      metrics: { unresolved: alerts.length, escalated, uncertain: alerts.filter(a => a.uncertain).length,
        enrollment_ids: alerts.slice(0, 50).map(a => a.id) },
    });
  },

  async sweep(): Promise<void> {
    let failures = 0;
    for (let offset = 0; ; offset += PAGE) {
      const { data, error } = await getSupabase().from('merchants').select('id,location_id')
        .order('id').range(offset, offset + PAGE - 1);
      if (error) throw error;
      for (const merchant of data || []) {
        try { await this.checkLocation(merchant.location_id, merchant.id); }
        catch { failures++; logger.error({ locationId: merchant.location_id }, 'Recurring setup health check failed; existing alerts remain unresolved'); }
      }
      if ((data || []).length < PAGE) break;
    }
    if (failures) throw new Error(`Recurring setup health failed for ${failures} location(s)`);
  },
};
