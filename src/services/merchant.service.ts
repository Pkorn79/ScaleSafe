import { ghlApi } from '../clients/ghl.client';
import { merchantRepository, MerchantRecord } from '../repositories/merchant.repository';
import { paymentProviderService } from './payment-provider.service';
import { logger } from '../utils/logger';
import { BETA_CUSTOM_FIELD_REGISTRY, CUSTOM_VALUE_REGISTRY } from '../constants/ghl-fields';
import { STANDARD_CLAUSES, StandardClauseKey } from '../constants/standard-clauses';
import { getSupabase } from '../clients/supabase.client';
import { triggerHealthService } from './trigger-health.service';
import { isMerchantWebhookSecretEnforced } from '../utils/webhook-enforcement';
import { getPaymentReminderDiagnostics } from '../jobs/payment-reminder-check';

// ─── Types ───────────────────────────────────────────────────────────

/** Full merchant config returned by getFullConfig */
export interface MerchantFullConfig {
  locationId: string;
  onboardingComplete: boolean;
  status: string;
  snapshotStatus: string;
  snapshotError: string;

  businessName: string;
  dbaName: string;
  supportEmail: string;
  descriptor: string;
  businessWebsite: string;
  businessCity: string;
  businessState: string;
  industryNiche: string;
  primaryServiceType: string;
  logoUrl: string;
  shortDescription: string;

  enrollmentFunnelUrl: string;
  pulseFormUrl: string;

  stripeConnected: boolean;
  stripeUserId: string;

  nmiConnected: boolean;
  nmiProcessorId: string;
  defaultProcessor: '' | 'nmi' | 'stripe';

  tcHasOwn: boolean;
  tcDocumentUrl: string;
  tcCustomHtml: string;
  standardClauses: Record<StandardClauseKey, boolean>;
  customClause1Title: string;
  customClause1Text: string;
  customClause2Title: string;
  customClause2Text: string;

  modules: {
    sessions: boolean;
    milestones: boolean;
    pulse: boolean;
    payments: boolean;
    course: boolean;
  };

  dunningEnabled: boolean;
  dunningMaxRetries: number;

  engagementEnabled: boolean;

  config: Record<string, unknown>;
}

/** Update payload for updateFullConfig */
export interface MerchantConfigUpdate {
  businessName?: string;
  dbaName?: string;
  supportEmail?: string;
  descriptor?: string;
  businessWebsite?: string;
  businessCity?: string;
  businessState?: string;
  industryNiche?: string;
  primaryServiceType?: string;
  logoUrl?: string;
  shortDescription?: string;

  tcHasOwn?: boolean;
  tcDocumentUrl?: string;
  tcCustomHtml?: string;
  standardClauses?: Partial<Record<StandardClauseKey, boolean>>;
  customClause1Title?: string;
  customClause1Text?: string;
  customClause2Title?: string;
  customClause2Text?: string;

  enrollmentFunnelUrl?: string;
  pulseFormUrl?: string;

  modules?: {
    sessions?: boolean;
    milestones?: boolean;
    pulse?: boolean;
    payments?: boolean;
    course?: boolean;
  };

  dunningEnabled?: boolean;
  dunningMaxRetries?: number;

  engagementEnabled?: boolean;

  config?: Record<string, unknown>;
}

export interface ProvisioningHealthItem {
  key: string;
  label: string;
  status: 'pass' | 'warn' | 'fail';
  message: string;
  details?: Record<string, unknown>;
}

export interface ProvisioningHealthReport {
  locationId: string;
  overallStatus: 'pass' | 'warn' | 'fail';
  checkedAt: string;
  items: ProvisioningHealthItem[];
}

const WEBHOOK_SECRET_CUSTOM_VALUE_KEY = 'WEBHOOK_SECRET';
const WEBHOOK_SECRET_MERGE_FIELD = '{{ custom_values.scalesafe_webhook_secret }}';

// ─── Provisioning constants ──────────────────────────────────────────

const BETA_FIELDS_TO_CREATE = BETA_CUSTOM_FIELD_REGISTRY;
const BETA_ALLOWED_CUSTOM_FIELD_KEYS = new Set([
  ...BETA_CUSTOM_FIELD_REGISTRY.map((field) => `contact.${field.fieldKey}`),
  ...STANDARD_CLAUSES.map((clause) => clause.ghlFieldKey),
]);
const SCALESAFE_FIELD_PREFIXES = [
  'contact.ss_',
  'contact.offer_',
  'contact.clickwrap_',
];

interface GhlCustomField {
  id?: string;
  name?: string;
  fieldKey?: string;
  field_key?: string;
  dataType?: string;
  data_type?: string;
}

interface CustomFieldRepairReport {
  expectedCount: number;
  alreadyExisted: string[];
  created: string[];
  failed: string[];
  deleteCandidates: Array<{ id: string; name: string; fieldKey: string }>;
}

interface CustomFieldCleanupReport {
  dryRun: boolean;
  deleted: Array<{ id: string; name: string; fieldKey: string }>;
  failed: Array<{ id: string; name: string; fieldKey: string; error: string }>;
  candidates: Array<{ id: string; name: string; fieldKey: string }>;
}

function normalizeCustomFields(data: any): GhlCustomField[] {
  return data?.customFields || data?.fields || (Array.isArray(data) ? data : []);
}

function customFieldKey(field: GhlCustomField): string {
  return field.fieldKey || field.field_key || '';
}

function customFieldName(field: GhlCustomField): string {
  return field.name || customFieldKey(field) || field.id || 'Unknown field';
}

function isScaleSafeOwnedField(field: GhlCustomField): boolean {
  const key = customFieldKey(field);
  return SCALESAFE_FIELD_PREFIXES.some((prefix) => key.startsWith(prefix));
}

function makeDeleteCandidates(fields: GhlCustomField[]): Array<{ id: string; name: string; fieldKey: string }> {
  return fields
    .filter((field) => field.id && isScaleSafeOwnedField(field) && !BETA_ALLOWED_CUSTOM_FIELD_KEYS.has(customFieldKey(field)))
    .map((field) => ({
      id: field.id!,
      name: customFieldName(field),
      fieldKey: customFieldKey(field),
    }))
    .sort((a, b) => a.fieldKey.localeCompare(b.fieldKey));
}

// ─── Service ─────────────────────────────────────────────────────────

export const merchantService = {

  // ═══════════════════════════════════════════════════════════════════
  // PROVISIONING (existing — runs after OAuth install)
  // ═══════════════════════════════════════════════════════════════════

  async provisionMerchant(locationId: string): Promise<void> {
    logger.info({ locationId }, 'Starting merchant provisioning');
    await merchantRepository.updateSnapshotStatus(locationId, 'installing');

    try {
      try {
        await merchantRepository.ensureWebhookSecret(locationId);
      } catch (err: any) {
        logger.warn({ locationId, err: err.message }, 'Webhook secret provisioning skipped - migration may not be applied yet');
      }

      const api = await ghlApi(locationId);

      await Promise.all([
        this.createCustomFields(api, locationId),
        this.createCustomValues(api, locationId),
      ]);

      const merchant = await merchantRepository.getByLocationId(locationId);

      // Check if all custom values were captured
      const cvIds = merchant.custom_value_ids || {};
      const expectedCount = CUSTOM_VALUE_REGISTRY.length;
      const actualCount = Object.keys(cvIds).length;

      if (actualCount < expectedCount) {
        await merchantRepository.updateSnapshotStatus(locationId, 'partial',
          `${actualCount}/${expectedCount} custom values provisioned. Missing: ${CUSTOM_VALUE_REGISTRY.filter(e => !cvIds[e.key]).map(e => e.key).join(', ')}`);
        logger.warn({ locationId, actualCount, expectedCount }, 'Provisioning partial — some custom values missing');
      } else {
        await merchantRepository.updateSnapshotStatus(locationId, 'installed');
        logger.info({ locationId }, 'Merchant provisioning complete');
      }

      // Register as custom payment provider + generate API keys (non-blocking)
      this.registerPaymentProvider(locationId).catch((err: any) => {
        logger.warn({ err: err.message, locationId }, 'Payment provider registration failed — can retry later');
      });
    } catch (err: any) {
      logger.error({ err, locationId }, 'Merchant provisioning failed');
      await merchantRepository.updateSnapshotStatus(locationId, 'failed', err.message);

      const merchant = await merchantRepository.getByLocationId(locationId);
      if (merchant.snapshot_attempts < 3) {
        const delay = Math.pow(2, merchant.snapshot_attempts) * 5000;
        logger.info({ locationId, attempt: merchant.snapshot_attempts, retryIn: delay }, 'Scheduling provisioning retry');
        setTimeout(() => this.provisionMerchant(locationId), delay);
      } else {
        logger.error({ locationId, attempts: merchant.snapshot_attempts }, 'Provisioning failed after max retries');
      }
    }
  },

  async getProvisioningHealth(locationId: string): Promise<ProvisioningHealthReport> {
    const checkedAt = new Date().toISOString();
    const merchant = await merchantRepository.getByLocationId(locationId);
    const items: ProvisioningHealthItem[] = [];

    const add = (item: ProvisioningHealthItem) => items.push(item);

    add({
      key: 'merchant_record',
      label: 'Merchant record',
      status: merchant.status === 'active' ? 'pass' : 'warn',
      message: `Merchant status is ${merchant.status || 'unknown'}.`,
      details: {
        onboardingComplete: merchant.onboarding_complete,
        snapshotStatus: merchant.snapshot_status,
        snapshotAttempts: merchant.snapshot_attempts,
      },
    });

    add({
      key: 'webhook_secret',
      label: 'Workflow webhook secret',
      status: merchant.webhook_secret ? 'pass' : 'fail',
      message: merchant.webhook_secret
        ? 'Webhook secret is present.'
        : 'Webhook secret is missing; run provisioning/backfill before enabling webhook enforcement.',
      details: {
        headerName: 'x-scalesafe-webhook-secret',
        mergeField: WEBHOOK_SECRET_MERGE_FIELD,
        enforcementEnabled: isMerchantWebhookSecretEnforced(),
      },
    });

    add({
      key: 'payment_provider',
      label: 'GHL custom payment provider',
      status: merchant.payment_provider_registered && merchant.provider_api_key ? 'pass' : 'warn',
      message: merchant.payment_provider_registered && merchant.provider_api_key
        ? 'Payment provider registration and API key are present.'
        : 'Payment provider registration or API key is missing; retry provisioning if this is a fresh install.',
      details: {
        registered: merchant.payment_provider_registered,
        hasApiKey: Boolean(merchant.provider_api_key),
        hasPublishableKey: Boolean(merchant.provider_publishable_key),
      },
    });

    add({
      key: 'processor_config',
      label: 'Processor configuration',
      status: merchant.default_processor || merchant.stripe_connected ? 'pass' : 'warn',
      message: merchant.default_processor || merchant.stripe_connected
        ? `Default processor is ${merchant.default_processor || 'stripe'}.`
        : 'No default processor is configured yet.',
      details: {
        defaultProcessor: merchant.default_processor,
        stripeConnected: merchant.stripe_connected,
      },
    });

    try {
      const api = await ghlApi(locationId);

      const [fieldsRes, valuesRes] = await Promise.allSettled([
        api.get(`/locations/${locationId}/customFields`),
        api.get(`/locations/${locationId}/customValues`),
      ]);

      if (fieldsRes.status === 'fulfilled') {
        const fields = normalizeCustomFields(fieldsRes.value.data);
        const keys = new Set(fields.map(customFieldKey));
        const expected = BETA_FIELDS_TO_CREATE.map((f) => `contact.${f.fieldKey}`);
        const missing = expected.filter((key) => !keys.has(key));
        const deleteCandidates = makeDeleteCandidates(fields);
        add({
          key: 'custom_fields',
          label: 'ScaleSafe contact fields',
          status: missing.length === 0 ? 'pass' : 'warn',
          message: missing.length === 0
            ? `All ${expected.length} beta ScaleSafe contact fields are present.`
            : `${missing.length}/${expected.length} beta ScaleSafe contact fields are missing.`,
          details: {
            expectedCount: expected.length,
            totalGhlCustomFields: fields.length,
            missing,
            deleteCandidateCount: deleteCandidates.length,
            deleteCandidates,
          },
        });
      } else {
        add({
          key: 'custom_fields',
          label: 'ScaleSafe contact fields',
          status: 'warn',
          message: 'Could not query GHL custom fields.',
          details: { error: fieldsRes.reason?.message || String(fieldsRes.reason) },
        });
      }

      if (valuesRes.status === 'fulfilled') {
        const values = valuesRes.value.data.customValues || valuesRes.value.data || [];
        const discoveredKeys = merchant.custom_value_ids || {};
        const missing = CUSTOM_VALUE_REGISTRY
          .filter((def) => !discoveredKeys[def.key])
          .map((def) => def.key);
        const webhookSecretMapped = Boolean(discoveredKeys[WEBHOOK_SECRET_CUSTOM_VALUE_KEY]);
        add({
          key: 'custom_values',
          label: 'ScaleSafe custom values',
          status: missing.length === 0 ? 'pass' : 'warn',
          message: missing.length === 0
            ? `All ${CUSTOM_VALUE_REGISTRY.length} expected custom values are mapped.`
            : `${missing.length}/${CUSTOM_VALUE_REGISTRY.length} expected custom values are not mapped in ScaleSafe.`,
          details: {
            expectedCount: CUSTOM_VALUE_REGISTRY.length,
            mappedCount: Object.keys(discoveredKeys).length,
            totalGhlCustomValues: Array.isArray(values) ? values.length : null,
            webhookSecretMapped,
            webhookSecretMergeField: WEBHOOK_SECRET_MERGE_FIELD,
            missing,
          },
        });
      } else {
        add({
          key: 'custom_values',
          label: 'ScaleSafe custom values',
          status: 'warn',
          message: 'Could not query GHL custom values.',
          details: { error: valuesRes.reason?.message || String(valuesRes.reason) },
        });
      }
    } catch (err: any) {
      add({
        key: 'ghl_api',
        label: 'GHL API access',
        status: 'warn',
        message: 'Could not create a GHL API client for this tenant.',
        details: { error: err.message },
      });
    }

    try {
      const triggerHealth = await triggerHealthService.getHealth(locationId);
      const criticalMissing = triggerHealth.criticalMissingSubscriptions.length;
      const noSubscription = triggerHealth.recentNoSubscriptionTriggers.length;
      add({
        key: 'trigger_health',
        label: 'ScaleSafe trigger health',
        status: criticalMissing > 0 || noSubscription > 0 ? 'warn' : 'pass',
        message: criticalMissing > 0
          ? `${criticalMissing} beta-critical trigger(s) have no active GHL workflow subscription.`
          : noSubscription > 0
            ? `${noSubscription} trigger(s) recently fired with no active workflow subscription.`
            : `${triggerHealth.activeSubscriptionRows} active workflow subscription(s) are mapped.`,
        details: triggerHealth as unknown as Record<string, unknown>,
      });

      add({
        key: 'field_automation_health',
        label: 'Field automation health',
        status: 'pass',
        message: 'At Risk and Re-Engaged automations use GHL Contact Field Changed on ss_engagement_status.',
        details: {
          fieldAutomations: triggerHealth.fieldAutomations,
        },
      });
    } catch (err: any) {
      add({
        key: 'trigger_health',
        label: 'ScaleSafe trigger health',
        status: 'warn',
        message: 'Could not query trigger subscriptions or trigger delivery logs.',
        details: { error: err.message || String(err) },
      });
    }

    try {
      const reminderDiagnostics = await getPaymentReminderDiagnostics(locationId);
      add({
        key: 'payment_reminder_diagnostics',
        label: 'Payment reminder readiness',
        status: reminderDiagnostics.status === 'needs_setup' ? 'warn' : 'pass',
        message: reminderDiagnostics.message,
        details: reminderDiagnostics as unknown as Record<string, unknown>,
      });
    } catch (err: any) {
      add({
        key: 'payment_reminder_diagnostics',
        label: 'Payment reminder readiness',
        status: 'warn',
        message: 'Could not inspect payment reminder eligibility.',
        details: { error: err.message || String(err) },
      });
    }

    try {
      const pulseDiagnostics = await this.getPulseReadiness(locationId, merchant);
      add({
        key: 'pulse_diagnostics',
        label: 'Pulse check readiness',
        status: pulseDiagnostics.status === 'needs_setup' ? 'warn' : 'pass',
        message: pulseDiagnostics.message,
        details: pulseDiagnostics as unknown as Record<string, unknown>,
      });
    } catch (err: any) {
      add({
        key: 'pulse_diagnostics',
        label: 'Pulse check readiness',
        status: 'warn',
        message: 'Could not inspect pulse check readiness.',
        details: { error: err.message || String(err) },
      });
    }

    const overallStatus = items.some((item) => item.status === 'fail')
      ? 'fail'
      : items.some((item) => item.status === 'warn')
        ? 'warn'
        : 'pass';

    return { locationId, overallStatus, checkedAt, items };
  },

  async getPulseReadiness(locationId: string, merchant: MerchantRecord): Promise<Record<string, unknown> & {
    status: 'ready' | 'needs_setup' | 'no_due_pulses';
    message: string;
  }> {
    const supabase = getSupabase();
    const config = merchant.config || {};
    const merchantConfigPulseUrl = String(config.pulse_form_url || '');
    const envPulseUrl = String(process.env.PULSE_FORM_URL || '');
    let ghlCustomValuePulseUrl = '';
    let formUrl = merchantConfigPulseUrl || envPulseUrl;
    const cvIds = merchant.custom_value_ids || {};
    if (!formUrl && cvIds.PULSE_FORM_URL) {
      const values = await this.readGhlCustomValues(locationId);
      ghlCustomValuePulseUrl = String(values[cvIds.PULSE_FORM_URL] || '');
      formUrl = ghlCustomValuePulseUrl;
    }

    const [dueRes, subscriptionRes, logsRes] = await Promise.all([
      supabase
        .from('enrollments')
        .select('id')
        .eq('location_id', locationId)
        .eq('pulse_cadence_enabled', true)
        .lte('next_pulse_due_at', new Date().toISOString())
        .in('status', ['enrolled', 'active']),
      supabase
        .from('trigger_subscriptions')
        .select('id')
        .eq('location_id', locationId)
        .eq('trigger_key', 'ss_app_event')
        .eq('is_active', true),
      supabase
        .from('trigger_delivery_logs')
        .select('status, payload, created_at')
        .eq('location_id', locationId)
        .eq('trigger_key', 'ss_app_event')
        .order('created_at', { ascending: false })
        .limit(200),
    ]);

    if (dueRes.error) throw dueRes.error;
    if (subscriptionRes.error) throw subscriptionRes.error;
    if (logsRes.error) throw logsRes.error;

    const dueCount = (dueRes.data || []).length;
    const activeAppEventSubscriptions = (subscriptionRes.data || []).length;
    const pulseLogs = (logsRes.data || []).filter((log: any) => log.payload?.event_type === 'pulse_check_due');
    const pulseEnabled = merchant.module_pulse !== false;
    const formUrlConfigured = Boolean(formUrl);
    const status = dueCount === 0
      ? 'no_due_pulses'
      : !pulseEnabled || !formUrlConfigured || activeAppEventSubscriptions === 0
        ? 'needs_setup'
        : 'ready';
    const message = dueCount === 0
      ? 'No pulse check-ins are currently due.'
      : !pulseEnabled
        ? 'Pulse is disabled for this merchant.'
        : !formUrlConfigured
          ? 'Pulse check-ins are due, but the Pulse Form URL is missing. Checked merchant settings, environment fallback, and the GHL custom value.'
          : activeAppEventSubscriptions === 0
            ? 'Pulse check-ins are due, but the ScaleSafe App Event workflow is not subscribed.'
            : `${dueCount} pulse check-in(s) are due and ready to send.`;

    return {
      pulseEnabled,
      formUrlConfigured,
      formUrlSources: {
        merchantConfig: Boolean(merchantConfigPulseUrl),
        environment: Boolean(envPulseUrl),
        ghlCustomValue: Boolean(ghlCustomValuePulseUrl),
      },
      activeAppEventSubscriptions,
      dueCount,
      recentPulseSentAt: pulseLogs.find((log: any) => log.status === 'sent')?.created_at || null,
      recentPulseNoSubscriptionAt: pulseLogs.find((log: any) => log.status === 'no_subscription')?.created_at || null,
      lastSkippedReason: dueCount > 0 && !pulseEnabled
        ? 'pulse_module_disabled'
        : dueCount > 0 && !formUrlConfigured
        ? 'pulse_form_url_missing'
        : dueCount > 0 && activeAppEventSubscriptions === 0
          ? 'ss_app_event_subscription_missing'
          : null,
      status,
      message,
    };
  },

  /**
   * Register ScaleSafe as a custom payment provider and generate API keys.
   * Called after provisioning succeeds. Does NOT call connectConfig — that
   * happens when the merchant connects a processor (NMI/Stripe).
   */
  async registerPaymentProvider(locationId: string): Promise<void> {
    await paymentProviderService.repairProvider(locationId);
    logger.info({ locationId }, 'Payment provider registered and API keys generated');
  },

  async repairPaymentProvider(locationId: string): Promise<ProvisioningHealthReport> {
    await paymentProviderService.repairProvider(locationId);
    return this.getProvisioningHealth(locationId);
  },

  async ensureWorkflowWebhookSecret(locationId: string): Promise<string | null> {
    const secret = await merchantRepository.ensureWebhookSecret(locationId);
    if (secret) {
      await this.syncWebhookSecretCustomValue(locationId, secret).catch((err: any) => {
        logger.warn({ err, locationId }, 'Failed to sync workflow webhook secret custom value');
      });
    }
    return secret;
  },

  async repairWorkflowWebhookSecretCustomValue(locationId: string): Promise<ProvisioningHealthReport> {
    const secret = await merchantRepository.ensureWebhookSecret(locationId);
    const api = await ghlApi(locationId);
    await this.createCustomValues(api, locationId);
    if (secret) {
      await this.syncWebhookSecretCustomValue(locationId, secret);
    }
    logger.info({ locationId }, 'Workflow webhook secret custom value repaired');
    return this.getProvisioningHealth(locationId);
  },

  async repairWorkflowCompatibleCustomFields(locationId: string): Promise<ProvisioningHealthReport> {
    const api = await ghlApi(locationId);
    const report = await this.createCustomFields(api, locationId);
    logger.info(
      {
        locationId,
        expectedCount: report.expectedCount,
        createdCount: report.created.length,
        failedCount: report.failed.length,
        deleteCandidateCount: report.deleteCandidates.length,
      },
      'Workflow-compatible custom fields repaired',
    );
    return this.getProvisioningHealth(locationId);
  },

  async cleanupWorkflowCustomFieldCandidates(locationId: string, confirmDelete = false): Promise<CustomFieldCleanupReport> {
    const api = await ghlApi(locationId);
    const res = await api.get(`/locations/${locationId}/customFields`);
    const candidates = makeDeleteCandidates(normalizeCustomFields(res.data));

    if (!confirmDelete) {
      return { dryRun: true, deleted: [], failed: [], candidates };
    }

    const deleted: CustomFieldCleanupReport['deleted'] = [];
    const failed: CustomFieldCleanupReport['failed'] = [];
    for (const candidate of candidates) {
      try {
        await api.delete(`/locations/${locationId}/customFields/${candidate.id}`);
        deleted.push(candidate);
      } catch (err: any) {
        failed.push({ ...candidate, error: err.message || String(err) });
      }
    }

    logger.warn({ locationId, deletedCount: deleted.length, failedCount: failed.length }, 'Workflow custom field cleanup executed');
    return { dryRun: false, deleted, failed, candidates };
  },

  async rotateWorkflowWebhookSecret(locationId: string): Promise<string> {
    const secret = await merchantRepository.rotateWebhookSecret(locationId);
    await this.syncWebhookSecretCustomValue(locationId, secret).catch((err: any) => {
      logger.warn({ err, locationId }, 'Failed to sync rotated workflow webhook secret custom value');
    });
    return secret;
  },

  async findPipeline(api: ReturnType<typeof ghlApi> extends Promise<infer T> ? T : never, locationId: string): Promise<string | null> {
    try {
      const res = await api.get('/opportunities/pipelines', { params: { locationId } });
      const pipelines = res.data.pipelines || res.data || [];
      const existing = pipelines.find((p: any) => p.name === 'Client Milestones');
      if (existing) {
        logger.info({ locationId, pipelineId: existing.id }, 'Client Milestones pipeline found');
        return existing.id;
      }
      logger.warn({ locationId }, 'Client Milestones pipeline not found — Snapshot may not have installed yet');
      return null;
    } catch (err) {
      logger.warn({ err, locationId }, 'Could not list pipelines');
      return null;
    }
  },

  async createCustomFields(api: ReturnType<typeof ghlApi> extends Promise<infer T> ? T : never, locationId: string): Promise<CustomFieldRepairReport> {
    let existingFields: GhlCustomField[] = [];
    let existingKeys = new Set<string>();
    try {
      const res = await api.get(`/locations/${locationId}/customFields`);
      existingFields = normalizeCustomFields(res.data);
      existingKeys = new Set(existingFields.map(customFieldKey));
    } catch (err) {
      logger.warn({ err, locationId }, 'Could not fetch existing custom fields');
    }

    const allFields = [...BETA_FIELDS_TO_CREATE];
    const toCreate = allFields.filter(f => !existingKeys.has(`contact.${f.fieldKey}`));
    const created: string[] = [];
    const failed: string[] = [];

    if (toCreate.length === 0) {
      logger.info({ locationId }, 'All custom fields already exist');
      return {
        expectedCount: allFields.length,
        alreadyExisted: allFields.map((field) => `contact.${field.fieldKey}`),
        created,
        failed,
        deleteCandidates: makeDeleteCandidates(existingFields),
      };
    }

    logger.info({ locationId, total: allFields.length, creating: toCreate.length }, 'Creating custom fields');

    let failures = 0;
    let authFailures = 0;
    for (let i = 0; i < toCreate.length; i += 5) {
      // If we hit auth failures on the first batch, stop early — no point retrying 50 times
      if (authFailures >= 5) {
        logger.warn({ locationId, authFailures }, 'Stopping custom field creation — auth/scope issue detected. Fields may already exist from Snapshot.');
        break;
      }

      const batch = toCreate.slice(i, i + 5);
      await Promise.all(batch.map(async (field) => {
        try {
          await api.post(`/locations/${locationId}/customFields`, {
            name: field.name,
            dataType: field.dataType,
          });
          created.push(`contact.${field.fieldKey}`);
        } catch (err: any) {
          const status = err.ghlStatus || err.status;
          if (status === 422 || status === 409) {
            logger.debug({ field: field.name, locationId }, 'Custom field already exists (conflict)');
            created.push(`contact.${field.fieldKey}`);
          } else if (status === 401 || status === 403 || (err.message && err.message.includes('authClass'))) {
            authFailures++;
            failed.push(`contact.${field.fieldKey}`);
            if (authFailures === 1) {
              logger.warn({ locationId, status, message: err.message?.slice(0, 200) }, 'Custom field auth/scope failure — token may be Company-scoped. Custom fields should be created by Snapshot instead.');
            }
          } else {
            failures++;
            failed.push(`contact.${field.fieldKey}`);
            logger.warn({ err, field: field.name, locationId }, 'Failed to create custom field (non-fatal)');
          }
        }
      }));
    }

    // Auth failures are NOT fatal — fields may exist from Snapshot or can be created manually
    if (authFailures > 0) {
      return {
        expectedCount: allFields.length,
        alreadyExisted: allFields
          .filter((field) => existingKeys.has(`contact.${field.fieldKey}`))
          .map((field) => `contact.${field.fieldKey}`),
        created,
        failed,
        deleteCandidates: makeDeleteCandidates(existingFields),
      };
    }

    if (failures > Math.floor(toCreate.length / 2)) {
      throw new Error(`Too many custom field failures (${failures}/${toCreate.length}) — likely a systemic issue`);
    }

    logger.info({ locationId, created: toCreate.length - failures, failures }, 'Custom fields created');
    let refreshedFields = existingFields;
    try {
      const refreshed = await api.get(`/locations/${locationId}/customFields`);
      if (refreshed?.data) {
        refreshedFields = normalizeCustomFields(refreshed.data);
        existingKeys = new Set(refreshedFields.map(customFieldKey));
      }
    } catch (err) {
      logger.warn({ err, locationId }, 'Could not refresh custom fields after repair');
    }
    return {
      expectedCount: allFields.length,
      alreadyExisted: allFields
        .filter((field) => existingKeys.has(`contact.${field.fieldKey}`) && !created.includes(`contact.${field.fieldKey}`))
        .map((field) => `contact.${field.fieldKey}`),
      created,
      failed,
      deleteCandidates: makeDeleteCandidates(refreshedFields),
    };
  },

  /**
   * Discover or create all ScaleSafe custom values for a location.
   * Matches existing values by fieldKey pattern (not name — names vary between locations).
   * Stores the per-merchant ID map in merchants.custom_value_ids.
   * Partial success is saved — only failed values need retry.
   */
  async createCustomValues(api: ReturnType<typeof ghlApi> extends Promise<infer T> ? T : never, locationId: string): Promise<void> {
    // 1. Fetch existing custom values and build fieldKey → {id, value} lookup
    const fieldKeyLookup: Record<string, { id: string; value: string }> = {};
    try {
      const res = await api.get(`/locations/${locationId}/customValues`);
      const values = res.data.customValues || res.data || [];
      for (const v of values) {
        // fieldKey format: "{{ custom_values.merchant_business_name }}"
        // Extract the pattern between "custom_values." and " }}"
        const match = (v.fieldKey || '').match(/custom_values\.(\w+)/);
        if (match && v.id) {
          fieldKeyLookup[match[1]] = { id: v.id, value: v.value || '' };
        }
      }
    } catch (err) {
      logger.warn({ err, locationId }, 'Could not fetch existing custom values');
    }

    // 2. Load any previously stored IDs (for retry of partial failures)
    const merchant = await merchantRepository.getByLocationId(locationId);
    const storedIds: Record<string, string> = { ...(merchant.custom_value_ids || {}) };

    // 3. For each registry entry: discover existing or create new
    let found = 0;
    let created = 0;
    let failures = 0;
    const failedKeys: string[] = [];

    for (const entry of CUSTOM_VALUE_REGISTRY) {
      // Skip if we already have this ID stored from a previous run
      if (storedIds[entry.key]) {
        found++;
        continue;
      }

      // Check if value exists by fieldKey pattern
      const existing = fieldKeyLookup[entry.fieldKeyMatch];
      if (existing) {
        storedIds[entry.key] = existing.id;
        found++;
        logger.debug({ locationId, key: entry.key, id: existing.id }, 'Custom value discovered by fieldKey');
        continue;
      }

      // Value doesn't exist — create it
      try {
        const res = await api.post(`/locations/${locationId}/customValues`, {
          name: entry.defaultName,
          value: this.defaultCustomValue(entry.key, merchant),
        });
        const newId = res.data?.customValue?.id || res.data?.id || '';
        if (newId) {
          storedIds[entry.key] = newId;
          created++;
          logger.info({ locationId, key: entry.key, name: entry.defaultName, id: newId }, 'Custom value created');
        } else {
          failures++;
          failedKeys.push(entry.key);
          logger.warn({ locationId, key: entry.key, response: JSON.stringify(res.data).slice(0, 200) }, 'Custom value created but no ID returned');
        }
      } catch (err: any) {
        const status = err.ghlStatus || err.status;
        if (status === 422 || status === 409) {
          // Already exists but we couldn't match by fieldKey — try to find it by re-fetching
          logger.warn({ locationId, key: entry.key, name: entry.defaultName }, 'Custom value conflict — may exist under different fieldKey');
          failures++;
          failedKeys.push(entry.key);
        } else {
          failures++;
          failedKeys.push(entry.key);
          logger.warn({ err, locationId, key: entry.key }, 'Failed to create custom value');
        }
      }
    }

    // 4. Save discovered IDs to Supabase (even if partial)
    await merchantRepository.update(locationId, { custom_value_ids: storedIds } as any);

    if (storedIds[WEBHOOK_SECRET_CUSTOM_VALUE_KEY] && merchant.webhook_secret) {
      await this.writeGhlCustomValue(
        api,
        locationId,
        storedIds[WEBHOOK_SECRET_CUSTOM_VALUE_KEY],
        'ScaleSafe Webhook Secret',
        merchant.webhook_secret,
        WEBHOOK_SECRET_CUSTOM_VALUE_KEY,
      );
    }

    const total = CUSTOM_VALUE_REGISTRY.length;
    const succeeded = Object.keys(storedIds).length;
    logger.info({ locationId, total, found, created, failures, succeeded, failedKeys }, 'Custom values provisioning complete');

    // 5. If more than half failed, throw (systemic issue like auth failure)
    if (failures > Math.floor(total / 2)) {
      throw new Error(`Too many custom value failures (${failures}/${total}) — likely a systemic issue. Failed: ${failedKeys.join(', ')}`);
    }
  },

  defaultCustomValue(key: string, merchant: MerchantRecord): string {
    if (key === WEBHOOK_SECRET_CUSTOM_VALUE_KEY) return merchant.webhook_secret || '';
    return '';
  },

  async syncWebhookSecretCustomValue(locationId: string, secret: string): Promise<void> {
    const merchant = await merchantRepository.getByLocationId(locationId);
    const cvIds = merchant.custom_value_ids || {};
    const id = cvIds[WEBHOOK_SECRET_CUSTOM_VALUE_KEY];
    if (!id) return;

    const api = await ghlApi(locationId);
    await this.writeGhlCustomValue(
      api,
      locationId,
      id,
      'ScaleSafe Webhook Secret',
      secret,
      WEBHOOK_SECRET_CUSTOM_VALUE_KEY,
    );
  },

  async writeGhlCustomValue(
    api: ReturnType<typeof ghlApi> extends Promise<infer T> ? T : never,
    locationId: string,
    id: string,
    name: string,
    value: string,
    key: string,
  ): Promise<void> {
    try {
      await api.put(`/locations/${locationId}/customValues/${id}`, { name, value });
    } catch (err) {
      logger.warn({ err, locationId, key, customValueId: id }, 'Failed to update GHL custom value');
      throw err;
    }
  },

  async fetchLocationInfo(locationId: string): Promise<void> {
    try {
      const api = await ghlApi(locationId);
      const res = await api.get(`/locations/${locationId}`);
      const loc = res.data.location || res.data;

      const updates: Record<string, unknown> = {};
      if (loc.name) updates.business_name = loc.name;
      if (loc.email) updates.support_email = loc.email;

      if (Object.keys(updates).length > 0) {
        await merchantRepository.update(locationId, updates as any);
        logger.info({ locationId, updates }, 'Merchant info populated from GHL location');
      }
    } catch (err) {
      logger.warn({ err, locationId }, 'Could not fetch location info (non-fatal)');
    }
  },

  // ═══════════════════════════════════════════════════════════════════
  // FULL CONFIG MANAGEMENT (Phase 3 — Merchant Onboarding)
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Get full merchant config — merges Supabase record with GHL custom values.
   */
  async getFullConfig(locationId: string): Promise<MerchantFullConfig> {
    const merchant = await merchantRepository.getByLocationId(locationId);
    const cvIds = merchant.custom_value_ids || {};

    // Fetch GHL custom values to get current state (best-effort)
    let ghlValues: Record<string, string> = {};
    try {
      ghlValues = await this.readGhlCustomValues(locationId);
    } catch (err) {
      logger.warn({ err, locationId }, 'Could not fetch GHL custom values — using Supabase only');
    }

    // Helper: get GHL value by canonical key using stored per-merchant ID
    const gv = (key: string) => {
      const id = cvIds[key];
      return id ? (ghlValues[id] || '') : '';
    };

    const cfg = merchant.config || {};
    const clauseToggles = (merchant as any).tc_clause_toggles || {};

    // Look up active NMI processor config for this merchant (best-effort — if
    // the table read fails for any reason, fall back to nmiConnected=false so
    // the Settings page still loads).
    let nmiConnected = false;
    let nmiProcessorId = '';
    try {
      const supabase = getSupabase();
      const { data: nmiCfg } = await supabase
        .from('processor_configs')
        .select('id, nmi_processor_id')
        .eq('merchant_id', merchant.id)
        .eq('processor_type', 'nmi')
        .eq('is_active', true)
        .eq('is_default', true)
        .maybeSingle();
      if (nmiCfg) {
        nmiConnected = true;
        nmiProcessorId = (nmiCfg as any).nmi_processor_id || '';
      }
    } catch (err) {
      logger.warn({ err, locationId }, 'Failed to look up NMI processor config — defaulting to disconnected');
    }

    // Build standard clause toggle map
    const standardClauses: Record<string, boolean> = {};
    for (const clause of STANDARD_CLAUSES) {
      const stored = clauseToggles[clause.key];
      standardClauses[clause.key] = stored !== undefined ? stored : clause.recommended;
    }

    return {
      locationId: merchant.location_id,
      onboardingComplete: merchant.onboarding_complete,
      status: merchant.status,
      snapshotStatus: merchant.snapshot_status,
      snapshotError: (merchant as any).snapshot_error || '',

      businessName: merchant.business_name || gv('BUSINESS_NAME') || '',
      dbaName: merchant.dba_name || gv('DBA_BRAND_NAME') || '',
      supportEmail: merchant.support_email || gv('SUPPORT_EMAIL') || '',
      descriptor: merchant.descriptor || gv('DESCRIPTOR') || '',
      businessWebsite: gv('BUSINESS_WEBSITE') || (cfg as any).business_website || '',
      businessCity: gv('BUSINESS_CITY') || (cfg as any).business_city || '',
      businessState: gv('BUSINESS_STATE') || (cfg as any).business_state || '',
      industryNiche: merchant.industry || gv('INDUSTRY_NICHE') || '',
      primaryServiceType: gv('PRIMARY_SERVICE_TYPE') || (cfg as any).primary_service_type || '',
      logoUrl: merchant.logo_url || gv('LOGO_URL') || '',
      shortDescription: gv('SHORT_DESCRIPTION') || (cfg as any).short_description || '',
      enrollmentFunnelUrl: gv('WEBSITE_BASE_URL') || (cfg as any).enrollment_funnel_url || '',
      pulseFormUrl: (cfg as any).pulse_form_url || gv('PULSE_FORM_URL') || '',

      stripeConnected: merchant.stripe_connected || false,
      stripeUserId: merchant.stripe_user_id || '',

      nmiConnected,
      nmiProcessorId,
      defaultProcessor: ((merchant as any).default_processor || '') as '' | 'nmi' | 'stripe',

      tcHasOwn: gv('TC_HAS_OWN') === 'true' || (cfg as any).tc_has_own === true,
      tcDocumentUrl: gv('TC_DOCUMENT_URL') || (cfg as any).tc_document_url || '',
      tcCustomHtml: (cfg as any).tc_custom_html || '',
      standardClauses: standardClauses as Record<StandardClauseKey, boolean>,
      customClause1Title: gv('CUSTOM_CLAUSE_1_TITLE') || (cfg as any).custom_clause_1_title || '',
      customClause1Text: gv('CUSTOM_CLAUSE_1_TEXT') || (cfg as any).custom_clause_1_text || '',
      customClause2Title: gv('CUSTOM_CLAUSE_2_TITLE') || (cfg as any).custom_clause_2_title || '',
      customClause2Text: gv('CUSTOM_CLAUSE_2_TEXT') || (cfg as any).custom_clause_2_text || '',

      modules: {
        sessions: merchant.module_sessions,
        milestones: merchant.module_milestones,
        pulse: merchant.module_pulse,
        payments: merchant.module_payments,
        course: merchant.module_course,
      },

      dunningEnabled: (merchant as any).dunning_enabled ?? true,
      dunningMaxRetries: (merchant as any).dunning_max_retries ?? 3,

      engagementEnabled: (merchant as any).engagement_enabled ?? true,

      config: cfg,
    };
  },

  /**
   * Update merchant config — writes to BOTH Supabase and GHL custom values.
   */
  async updateFullConfig(locationId: string, updates: MerchantConfigUpdate): Promise<MerchantFullConfig> {
    const merchant = await merchantRepository.getByLocationId(locationId);

    // 1. Build Supabase column updates
    const dbUpdates: Record<string, unknown> = {};
    if (updates.businessName !== undefined) dbUpdates.business_name = updates.businessName;
    if (updates.dbaName !== undefined) dbUpdates.dba_name = updates.dbaName;
    if (updates.supportEmail !== undefined) dbUpdates.support_email = updates.supportEmail;
    if (updates.descriptor !== undefined) dbUpdates.descriptor = updates.descriptor;
    if (updates.logoUrl !== undefined) dbUpdates.logo_url = updates.logoUrl;
    if (updates.industryNiche !== undefined) dbUpdates.industry = updates.industryNiche;

    if (updates.modules) {
      if (updates.modules.sessions !== undefined) dbUpdates.module_sessions = updates.modules.sessions;
      if (updates.modules.milestones !== undefined) dbUpdates.module_milestones = updates.modules.milestones;
      if (updates.modules.pulse !== undefined) dbUpdates.module_pulse = updates.modules.pulse;
      if (updates.modules.payments !== undefined) dbUpdates.module_payments = updates.modules.payments;
      if (updates.modules.course !== undefined) dbUpdates.module_course = updates.modules.course;
    }

    // Dunning settings
    if (updates.dunningEnabled !== undefined) dbUpdates.dunning_enabled = updates.dunningEnabled;
    if (updates.dunningMaxRetries !== undefined) dbUpdates.dunning_max_retries = updates.dunningMaxRetries;

    // Engagement tracking master toggle
    if (updates.engagementEnabled !== undefined) dbUpdates.engagement_enabled = updates.engagementEnabled;

    // 2. Store T&C clause toggles in dedicated JSONB column
    if (updates.standardClauses) {
      const existing = ((merchant as any).tc_clause_toggles || {}) as Record<string, boolean>;
      dbUpdates.tc_clause_toggles = { ...existing, ...updates.standardClauses };
    }

    // 3. Merge extended fields into config JSONB
    const existingConfig = (merchant.config || {}) as Record<string, unknown>;
    const configUpdates: Record<string, unknown> = { ...existingConfig };

    if (updates.businessWebsite !== undefined) configUpdates.business_website = updates.businessWebsite;
    if (updates.businessCity !== undefined) configUpdates.business_city = updates.businessCity;
    if (updates.businessState !== undefined) configUpdates.business_state = updates.businessState;
    if (updates.primaryServiceType !== undefined) configUpdates.primary_service_type = updates.primaryServiceType;
    if (updates.shortDescription !== undefined) configUpdates.short_description = updates.shortDescription;
    if (updates.pulseFormUrl !== undefined) configUpdates.pulse_form_url = updates.pulseFormUrl;
    if (updates.tcHasOwn !== undefined) configUpdates.tc_has_own = updates.tcHasOwn;
    if (updates.tcDocumentUrl !== undefined) configUpdates.tc_document_url = updates.tcDocumentUrl;
    if (updates.tcCustomHtml !== undefined) configUpdates.tc_custom_html = updates.tcCustomHtml;
    if (updates.customClause1Title !== undefined) configUpdates.custom_clause_1_title = updates.customClause1Title;
    if (updates.customClause1Text !== undefined) configUpdates.custom_clause_1_text = updates.customClause1Text;
    if (updates.customClause2Title !== undefined) configUpdates.custom_clause_2_title = updates.customClause2Title;
    if (updates.customClause2Text !== undefined) configUpdates.custom_clause_2_text = updates.customClause2Text;
    if (updates.enrollmentFunnelUrl !== undefined) configUpdates.enrollment_funnel_url = updates.enrollmentFunnelUrl;

    if (updates.config) {
      Object.assign(configUpdates, updates.config);
    }

    dbUpdates.config = configUpdates;

    // 4. Set onboarding_complete if business name + support email are present
    const finalBusinessName = (updates.businessName ?? merchant.business_name) || '';
    const finalSupportEmail = (updates.supportEmail ?? merchant.support_email) || '';
    if (finalBusinessName && finalSupportEmail) {
      dbUpdates.onboarding_complete = true;
    }

    await merchantRepository.update(locationId, dbUpdates as any);
    logger.info({ locationId }, 'Merchant config saved to Supabase');

    // 5. Compile T&C HTML
    const finalToggles = (dbUpdates.tc_clause_toggles || (merchant as any).tc_clause_toggles || {}) as Record<string, boolean>;
    const compiledHtml = this.compileTcHtml({
      tcHasOwn: updates.tcHasOwn ?? (configUpdates.tc_has_own as boolean) ?? false,
      tcDocumentUrl: updates.tcDocumentUrl ?? (configUpdates.tc_document_url as string) ?? '',
      standardClauses: finalToggles,
      customClause1Title: (configUpdates.custom_clause_1_title as string) || '',
      customClause1Text: (configUpdates.custom_clause_1_text as string) || '',
      customClause2Title: (configUpdates.custom_clause_2_title as string) || '',
      customClause2Text: (configUpdates.custom_clause_2_text as string) || '',
    });

    // 6. Sync to GHL custom values (best-effort, uses exact IDs)
    try {
      await this.syncConfigToGHL(locationId, updates, compiledHtml);
    } catch (err) {
      logger.warn({ err, locationId }, 'Failed to sync config to GHL custom values (non-fatal)');
    }

    return this.getFullConfig(locationId);
  },

  /**
   * Compile selected T&C clauses into HTML for compiled_terms_html.
   */
  compileTcHtml(opts: {
    tcHasOwn: boolean;
    tcDocumentUrl: string;
    standardClauses: Record<string, boolean>;
    customClause1Title: string;
    customClause1Text: string;
    customClause2Title: string;
    customClause2Text: string;
  }): string {
    const sections: string[] = [];

    // If merchant has their own T&C, include the link
    if (opts.tcHasOwn && opts.tcDocumentUrl) {
      sections.push(`<p>Full Terms & Conditions: <a href="${escapeHtml(opts.tcDocumentUrl)}" target="_blank">${escapeHtml(opts.tcDocumentUrl)}</a></p>`);
    }

    // Always include active clickwrap clauses
    const clauses: string[] = [];

    for (const clause of STANDARD_CLAUSES) {
      if (opts.standardClauses[clause.key]) {
        clauses.push(`<li>${escapeHtml(clause.text)}</li>`);
      }
    }

    if (opts.customClause1Title && opts.customClause1Text) {
      clauses.push(`<li><strong>${escapeHtml(opts.customClause1Title)}:</strong> ${escapeHtml(opts.customClause1Text)}</li>`);
    }
    if (opts.customClause2Title && opts.customClause2Text) {
      clauses.push(`<li><strong>${escapeHtml(opts.customClause2Title)}:</strong> ${escapeHtml(opts.customClause2Text)}</li>`);
    }

    if (clauses.length > 0) {
      sections.push(`<p><strong>By proceeding, you acknowledge and agree to the following:</strong></p>\n<ol>\n${clauses.join('\n')}\n</ol>`);
    }

    return sections.join('\n');
  },

  // ─── GHL Custom Value Helpers ──────────────────────────────────────

  /**
   * Read all GHL custom values for a location, returning id→value map.
   */
  async readGhlCustomValues(locationId: string): Promise<Record<string, string>> {
    const api = await ghlApi(locationId);
    const res = await api.get(`/locations/${locationId}/customValues`);
    const values = res.data.customValues || res.data || [];
    const map: Record<string, string> = {};
    for (const v of values) {
      map[v.id] = v.value || '';
    }
    return map;
  },

  /**
   * Sync config to GHL custom values using per-merchant stored IDs.
   * Uses PUT /locations/{locationId}/customValues/{id} for each value.
   */
  async syncConfigToGHL(locationId: string, updates: MerchantConfigUpdate, compiledHtml: string): Promise<void> {
    const merchant = await merchantRepository.getByLocationId(locationId);
    const cvIds = merchant.custom_value_ids || {};
    const api = await ghlApi(locationId);

    // Build key→name lookup from registry for GHL PUT (requires name + value)
    const registryNameMap: Record<string, string> = {};
    for (const entry of CUSTOM_VALUE_REGISTRY) {
      registryNameMap[entry.key] = entry.defaultName;
    }

    // Helper: queue a sync if the merchant has the ID for this key
    const toSync: Array<{ key: string; id: string; name: string; value: string }> = [];
    const push = (key: string, value: string) => {
      const id = cvIds[key];
      if (id) {
        toSync.push({ key, id, name: registryNameMap[key] || key, value });
      } else {
        logger.debug({ locationId, key }, 'Skipping GHL sync — no stored ID for this key');
      }
    };

    // Business info
    if (updates.businessName !== undefined)       push('BUSINESS_NAME', updates.businessName);
    if (updates.dbaName !== undefined)             push('DBA_BRAND_NAME', updates.dbaName);
    if (updates.supportEmail !== undefined)        push('SUPPORT_EMAIL', updates.supportEmail);
    if (updates.descriptor !== undefined)          push('DESCRIPTOR', updates.descriptor);
    if (updates.businessWebsite !== undefined)     push('BUSINESS_WEBSITE', updates.businessWebsite);
    if (updates.businessCity !== undefined)         push('BUSINESS_CITY', updates.businessCity);
    if (updates.businessState !== undefined)        push('BUSINESS_STATE', updates.businessState);
    if (updates.industryNiche !== undefined)        push('INDUSTRY_NICHE', updates.industryNiche);
    if (updates.primaryServiceType !== undefined)   push('PRIMARY_SERVICE_TYPE', updates.primaryServiceType);
    if (updates.logoUrl !== undefined)              push('LOGO_URL', updates.logoUrl);
    if (updates.shortDescription !== undefined)     push('SHORT_DESCRIPTION', updates.shortDescription);

    // T&C config
    if (updates.tcHasOwn !== undefined)             push('TC_HAS_OWN', String(updates.tcHasOwn));
    if (updates.tcDocumentUrl !== undefined)         push('TC_DOCUMENT_URL', updates.tcDocumentUrl);
    // Custom clauses + compiled T&C HTML are now per-offer (offers_mirror), not location-level custom values

    // Enrollment funnel URL
    if (updates.enrollmentFunnelUrl !== undefined) push('WEBSITE_BASE_URL', updates.enrollmentFunnelUrl);
    if (updates.pulseFormUrl !== undefined) push('PULSE_FORM_URL', updates.pulseFormUrl);

    // Evidence module toggles
    if (updates.modules) {
      if (updates.modules.sessions !== undefined)    push('MODULE_SESSIONS', updates.modules.sessions ? 'Enabled' : 'Disabled');
      if (updates.modules.milestones !== undefined)   push('MODULE_MILESTONES', updates.modules.milestones ? 'Enabled' : 'Disabled');
      if (updates.modules.pulse !== undefined)        push('MODULE_PULSE', updates.modules.pulse ? 'Enabled' : 'Disabled');
      if (updates.modules.payments !== undefined)     push('MODULE_PAYMENTS', updates.modules.payments ? 'Enabled' : 'Disabled');
      if (updates.modules.course !== undefined)       push('MODULE_COURSE', updates.modules.course ? 'Enabled' : 'Disabled');
    }

    // Write in batches of 5 to avoid GHL rate limits
    let synced = 0;
    let skipped = 0;
    for (let i = 0; i < toSync.length; i += 5) {
      const batch = toSync.slice(i, i + 5);
      await Promise.all(batch.map(async ({ key, id, name, value }) => {
        try {
          await this.writeGhlCustomValue(api, locationId, id, name, value, key);
          synced++;
        } catch (err) {
          skipped++;
        }
      }));
    }

    logger.info({ locationId, synced, skipped, total: toSync.length }, 'GHL custom values synced');
  },
};

/** Escape HTML special characters to prevent XSS in compiled T&C */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
