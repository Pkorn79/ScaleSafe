import { getSupabase } from '../clients/supabase.client';
import {
  FIELD_AUTOMATION_CONTRACTS,
  getTriggerContracts,
  TriggerContract,
} from '../constants/trigger-contracts';
import { appEventTypeMatches } from '../utils/app-event-type';

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

const RECENT_NO_SUBSCRIPTION_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

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
  lastDeliveryAcceptedAt: string | null;
  deliveryStatusMeaning: string;
  /** Compatibility alias. A 2xx trigger response does not prove an outbound message was sent. */
  lastSentAt: string | null;
  lastFailedAt: string | null;
  lastNoSubscriptionAt: string | null;
  lastPayloadAt: string | null;
  lastErrorMessage: string | null;
  missingFieldsInLastPayload: string[];
  appEventUses?: Array<{
    eventType: string;
    label: string;
    lastAppEventDeliveredAt: string | null;
    deliveryStatusMeaning: string;
    /** Compatibility alias for existing clients. */
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

function isRecentTimestamp(value: string | null | undefined, now = Date.now()): boolean {
  if (!value) return false;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) && now - parsed <= RECENT_NO_SUBSCRIPTION_WINDOW_MS;
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
    lastDeliveryAcceptedAt: lastSent?.created_at || null,
    deliveryStatusMeaning: 'The subscribed GHL trigger endpoint returned 2xx; downstream workflow actions and outbound messages require separate proof.',
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
  const eventLogs = logs.filter((log) => log.trigger_key === 'ss_app_event' && appEventTypeMatches(log.payload, eventType));
  const lastAppEventDeliveredAt = eventLogs.find((log) => log.status === 'sent')?.created_at || null;
  return {
    eventType,
    label,
    lastAppEventDeliveredAt,
    deliveryStatusMeaning: 'GHL accepted the ScaleSafe app event; this does not prove that an email or SMS was sent.',
    lastSentAt: lastAppEventDeliveredAt,
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
    const now = Date.now();
    const recentNoSubscriptionTriggers = rows
      .filter((row) => row.activeSubscriptionCount === 0 && isRecentTimestamp(row.lastNoSubscriptionAt, now))
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
