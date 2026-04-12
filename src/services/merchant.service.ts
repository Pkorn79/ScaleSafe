import { ghlApi } from '../clients/ghl.client';
import { merchantRepository, MerchantRecord } from '../repositories/merchant.repository';
import { paymentProviderService } from './payment-provider.service';
import { logger } from '../utils/logger';
import { CUSTOM_VALUE_REGISTRY } from '../constants/ghl-fields';
import { STANDARD_CLAUSES, StandardClauseKey } from '../constants/standard-clauses';

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

  stripeConnected: boolean;
  stripeUserId: string;

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

  modules?: {
    sessions?: boolean;
    milestones?: boolean;
    pulse?: boolean;
    payments?: boolean;
    course?: boolean;
  };

  config?: Record<string, unknown>;
}

// ─── Provisioning constants ──────────────────────────────────────────

const SS_FIELDS_TO_CREATE = [
  { name: 'SS Enrollment Status',  fieldKey: 'ss_enrollment_status',  dataType: 'TEXT' },
  { name: 'SS Evidence Score',     fieldKey: 'ss_evidence_score',     dataType: 'NUMERICAL' },
  { name: 'SS Last Evidence Date', fieldKey: 'ss_last_evidence_date', dataType: 'TEXT' },
  { name: 'SS Chargeback Status',  fieldKey: 'ss_chargeback_status',  dataType: 'TEXT' },
  { name: 'SS Defense Status',     fieldKey: 'ss_defense_status',     dataType: 'TEXT' },
];

const OFFER_FIELDS_TO_CREATE = [
  { name: 'Offer Business Name',        fieldKey: 'offer_business_name',        dataType: 'TEXT' },
  { name: 'Offer Name',                 fieldKey: 'offer_name',                 dataType: 'TEXT' },
  { name: 'Offer Price',                fieldKey: 'offer_price',                dataType: 'TEXT' },
  { name: 'Offer Payment Type',         fieldKey: 'offer_payment_type',         dataType: 'TEXT' },
  { name: 'Offer Installment Amount',   fieldKey: 'offer_installment_amount',   dataType: 'TEXT' },
  { name: 'Offer Installment Frequency',fieldKey: 'offer_installment_frequency',dataType: 'TEXT' },
  { name: 'Offer Num Payments',         fieldKey: 'offer_num_payments',         dataType: 'TEXT' },
  ...Array.from({ length: 11 }, (_, i) => [
    { name: `Offer Clause ${i + 1} Title`, fieldKey: `offer_clause_slot_${i + 1}_title`, dataType: 'TEXT' },
    { name: `Offer Clause ${i + 1} Text`,  fieldKey: `offer_clause_slot_${i + 1}_text`,  dataType: 'TEXT' },
  ]).flat(),
  ...Array.from({ length: 8 }, (_, i) => [
    { name: `Offer Milestone ${i + 1} Name`,        fieldKey: `offer_milestone_${i + 1}_name`,        dataType: 'TEXT' },
    { name: `Offer Milestone ${i + 1} Description`,  fieldKey: `offer_milestone_${i + 1}_description`, dataType: 'TEXT' },
  ]).flat(),
];

// ─── Service ─────────────────────────────────────────────────────────

export const merchantService = {

  // ═══════════════════════════════════════════════════════════════════
  // PROVISIONING (existing — runs after OAuth install)
  // ═══════════════════════════════════════════════════════════════════

  async provisionMerchant(locationId: string): Promise<void> {
    logger.info({ locationId }, 'Starting merchant provisioning');
    await merchantRepository.updateSnapshotStatus(locationId, 'installing');

    try {
      const api = await ghlApi(locationId);

      const [pipelineId] = await Promise.all([
        this.findPipeline(api, locationId),
        this.createCustomFields(api, locationId),
        this.createCustomValues(api, locationId),
      ]);

      const merchant = await merchantRepository.getByLocationId(locationId);
      const updatedConfig = { ...merchant.config, pipelineId: pipelineId || null };
      await merchantRepository.update(locationId, { config: updatedConfig } as any);

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
        logger.info({ locationId, pipelineId }, 'Merchant provisioning complete');
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

  /**
   * Register ScaleSafe as a custom payment provider and generate API keys.
   * Called after provisioning succeeds. Does NOT call connectConfig — that
   * happens when the merchant connects a processor (NMI/Stripe).
   */
  async registerPaymentProvider(locationId: string): Promise<void> {
    await paymentProviderService.registerProvider(locationId);
    await paymentProviderService.generateProviderApiKey(locationId);
    logger.info({ locationId }, 'Payment provider registered and API keys generated');
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

  async createCustomFields(api: ReturnType<typeof ghlApi> extends Promise<infer T> ? T : never, locationId: string): Promise<void> {
    let existingKeys = new Set<string>();
    try {
      const res = await api.get(`/locations/${locationId}/customFields`);
      const fields = res.data.customFields || res.data || [];
      existingKeys = new Set(fields.map((f: any) => f.fieldKey || f.field_key || ''));
    } catch (err) {
      logger.warn({ err, locationId }, 'Could not fetch existing custom fields');
    }

    const allFields = [...SS_FIELDS_TO_CREATE, ...OFFER_FIELDS_TO_CREATE];
    const toCreate = allFields.filter(f => !existingKeys.has(`contact.${f.fieldKey}`));

    if (toCreate.length === 0) {
      logger.info({ locationId }, 'All custom fields already exist');
      return;
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
        } catch (err: any) {
          const status = err.ghlStatus || err.status;
          if (status === 422 || status === 409) {
            logger.debug({ field: field.name, locationId }, 'Custom field already exists (conflict)');
          } else if (status === 401 || status === 403 || (err.message && err.message.includes('authClass'))) {
            authFailures++;
            if (authFailures === 1) {
              logger.warn({ locationId, status, message: err.message?.slice(0, 200) }, 'Custom field auth/scope failure — token may be Company-scoped. Custom fields should be created by Snapshot instead.');
            }
          } else {
            failures++;
            logger.warn({ err, field: field.name, locationId }, 'Failed to create custom field (non-fatal)');
          }
        }
      }));
    }

    // Auth failures are NOT fatal — fields may exist from Snapshot or can be created manually
    if (authFailures > 0) {
      logger.info({ locationId, authFailures, toCreate: toCreate.length }, 'Skipped custom field creation due to auth/scope — fields should be present from GHL Snapshot');
      return; // Don't throw — this is expected for Company-scoped tokens
    }

    if (failures > Math.floor(toCreate.length / 2)) {
      throw new Error(`Too many custom field failures (${failures}/${toCreate.length}) — likely a systemic issue`);
    }

    logger.info({ locationId, created: toCreate.length - failures, failures }, 'Custom fields created');
  },

  /**
   * Discover or create all 23 ScaleSafe custom values for a location.
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
          value: '',
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

    const total = CUSTOM_VALUE_REGISTRY.length;
    const succeeded = Object.keys(storedIds).length;
    logger.info({ locationId, total, found, created, failures, succeeded, failedKeys }, 'Custom values provisioning complete');

    // 5. If more than half failed, throw (systemic issue like auth failure)
    if (failures > Math.floor(total / 2)) {
      throw new Error(`Too many custom value failures (${failures}/${total}) — likely a systemic issue. Failed: ${failedKeys.join(', ')}`);
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

      stripeConnected: merchant.stripe_connected || false,
      stripeUserId: merchant.stripe_user_id || '',

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
    if (updates.customClause1Title !== undefined)    push('CUSTOM_CLAUSE_1_TITLE', updates.customClause1Title);
    if (updates.customClause1Text !== undefined)     push('CUSTOM_CLAUSE_1_TEXT', updates.customClause1Text);
    if (updates.customClause2Title !== undefined)    push('CUSTOM_CLAUSE_2_TITLE', updates.customClause2Title);
    if (updates.customClause2Text !== undefined)     push('CUSTOM_CLAUSE_2_TEXT', updates.customClause2Text);

    // Always sync compiled T&C HTML
    push('COMPILED_TERMS_HTML', compiledHtml);

    // Enrollment funnel URL
    if (updates.enrollmentFunnelUrl !== undefined) push('WEBSITE_BASE_URL', updates.enrollmentFunnelUrl);

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
          await api.put(`/locations/${locationId}/customValues/${id}`, { name, value });
          synced++;
        } catch (err) {
          skipped++;
          logger.warn({ err, locationId, key, customValueId: id }, 'Failed to update GHL custom value');
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
