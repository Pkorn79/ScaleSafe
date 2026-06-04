import { getSupabase } from '../clients/supabase.client';
import {
  FIELD_AUTOMATION_CONTRACTS,
  getTriggerContracts,
  TriggerContract,
} from '../constants/trigger-contracts';

interface TriggerSubscriptionRow {
  trigger_key: string;
  subscription_url: string;
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
}

interface TriggerDeliveryLogRow {
  trigger_key: string;
  subscription_url?: string | null;
  status: 'sent' | 'failed' | 'no_subscription';
  http_status?: number | null;
  error_message?: string | null;
  payload?: Record<string, unknown> | null;
  created_at: string;
}

export interface TriggerHealthRow {
  key: string;
  label: string;
  owner: string;
  sourceType: string;
  audience: string;
  betaStatus: string;
  firesFrom: string;
  requiredPayloadFields: string[];
  activeSubscriptionCount: number;
  activeSubscriptionUrls: string[];
  lastSentAt: string | null;
  lastFailedAt: string | null;
  lastNoSubscriptionAt: string | null;
  lastPayloadAt: string | null;
  lastErrorMessage: string | null;
  missingFieldsInLastPayload: string[];
  appEventUses?: Array<{
    eventType: string;
    label: string;
    lastSentAt: string | null;
    lastFailedAt: string | null;
    lastNoSubscriptionAt: string | null;
  }>;
}

export interface TriggerHealthReport {
  totalTriggers: number;
  activeSubscriptionRows: number;
  criticalMissingSubscriptions: string[];
  recentNoSubscriptionTriggers: string[];
  rows: TriggerHealthRow[];
  fieldAutomations: typeof FIELD_AUTOMATION_CONTRACTS;
}

function hasField(payload: Record<string, unknown> | null | undefined, field: string): boolean {
  if (!payload) return false;
  const value = payload[field];
  return value !== undefined && value !== null && String(value).trim() !== '';
}

function newestForStatus(
  logs: TriggerDeliveryLogRow[],
  triggerKey: string,
  status: TriggerDeliveryLogRow['status'],
): TriggerDeliveryLogRow | null {
  return logs.find((log) => log.trigger_key === triggerKey && log.status === status) || null;
}

function newestLog(logs: TriggerDeliveryLogRow[], triggerKey: string): TriggerDeliveryLogRow | null {
  return logs.find((log) => log.trigger_key === triggerKey) || null;
}

function buildRow(
  contract: TriggerContract,
  subscriptions: TriggerSubscriptionRow[],
  logs: TriggerDeliveryLogRow[],
): TriggerHealthRow {
  const active = subscriptions.filter((sub) => sub.trigger_key === contract.key && sub.is_active);
  const lastSent = newestForStatus(logs, contract.key, 'sent');
  const lastFailed = newestForStatus(logs, contract.key, 'failed');
  const lastNoSubscription = newestForStatus(logs, contract.key, 'no_subscription');
  const last = newestLog(logs, contract.key);
  const missingFields = last
    ? contract.requiredPayloadFields.filter((field) => !hasField(last.payload, field))
    : [];
  const appEventUses = contract.key === 'ss_app_event'
    ? [
        buildAppEventUse(logs, 'upcoming_payment_reminder', 'Upcoming Payment Reminder'),
        buildAppEventUse(logs, 'pulse_check_due', 'Pulse Check Due'),
      ]
    : undefined;

  return {
    key: contract.key,
    label: contract.label,
    owner: contract.owner,
    sourceType: contract.sourceType,
    audience: contract.audience,
    betaStatus: contract.betaStatus,
    firesFrom: contract.firesFrom,
    requiredPayloadFields: contract.requiredPayloadFields,
    activeSubscriptionCount: active.length,
    activeSubscriptionUrls: active.map((sub) => sub.subscription_url),
    lastSentAt: lastSent?.created_at || null,
    lastFailedAt: lastFailed?.created_at || null,
    lastNoSubscriptionAt: lastNoSubscription?.created_at || null,
    lastPayloadAt: last?.created_at || null,
    lastErrorMessage: lastFailed?.error_message || lastNoSubscription?.error_message || null,
    missingFieldsInLastPayload: missingFields,
    appEventUses,
  };
}

function buildAppEventUse(logs: TriggerDeliveryLogRow[], eventType: string, label: string) {
  const eventLogs = logs.filter((log) => log.trigger_key === 'ss_app_event' && log.payload?.event_type === eventType);
  return {
    eventType,
    label,
    lastSentAt: eventLogs.find((log) => log.status === 'sent')?.created_at || null,
    lastFailedAt: eventLogs.find((log) => log.status === 'failed')?.created_at || null,
    lastNoSubscriptionAt: eventLogs.find((log) => log.status === 'no_subscription')?.created_at || null,
  };
}

export const triggerHealthService = {
  async getHealth(locationId: string): Promise<TriggerHealthReport> {
    const supabase = getSupabase();
    const [subsRes, logsRes] = await Promise.all([
      supabase
        .from('trigger_subscriptions')
        .select('trigger_key, subscription_url, is_active, created_at, updated_at')
        .eq('location_id', locationId),
      supabase
        .from('trigger_delivery_logs')
        .select('trigger_key, subscription_url, status, http_status, error_message, payload, created_at')
        .eq('location_id', locationId)
        .order('created_at', { ascending: false })
        .limit(500),
    ]);

    if (subsRes.error) throw subsRes.error;
    if (logsRes.error) throw logsRes.error;

    const subscriptions = (subsRes.data || []) as TriggerSubscriptionRow[];
    const logs = (logsRes.data || []) as TriggerDeliveryLogRow[];
    const rows = getTriggerContracts().map((contract) => buildRow(contract, subscriptions, logs));
    const criticalMissingSubscriptions = rows
      .filter((row) => row.betaStatus === 'critical' && row.activeSubscriptionCount === 0)
      .map((row) => row.key);
    const recentNoSubscriptionTriggers = rows
      .filter((row) => Boolean(row.lastNoSubscriptionAt))
      .map((row) => row.key);

    return {
      totalTriggers: rows.length,
      activeSubscriptionRows: subscriptions.filter((sub) => sub.is_active).length,
      criticalMissingSubscriptions,
      recentNoSubscriptionTriggers,
      rows,
      fieldAutomations: FIELD_AUTOMATION_CONTRACTS,
    };
  },
};
