import { ghlApi } from '../clients/ghl.client';
import { merchantRepository, MerchantRecord } from '../repositories/merchant.repository';
import { logger } from '../utils/logger';
import { GHL_CUSTOM_VALUES } from '../constants/ghl-fields';
import { STANDARD_CLAUSES, StandardClauseKey } from '../constants/standard-clauses';
import * as CV from '../constants/ghl-custom-value-ids';

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

  tcHasOwn: boolean;
  tcDocumentUrl: string;
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
  standardClauses?: Partial<Record<StandardClauseKey, boolean>>;
  customClause1Title?: string;
  customClause1Text?: string;
  customClause2Title?: string;
  customClause2Text?: string;

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

      await merchantRepository.updateSnapshotStatus(locationId, 'installed');
      logger.info({ locationId, pipelineId }, 'Merchant provisioning complete');
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
    for (let i = 0; i < toCreate.length; i += 5) {
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
          } else {
            failures++;
            logger.warn({ err, field: field.name, locationId }, 'Failed to create custom field (non-fatal)');
          }
        }
      }));
    }

    if (failures > Math.floor(toCreate.length / 2)) {
      throw new Error(`Too many custom field failures (${failures}/${toCreate.length}) — likely a systemic issue`);
    }

    logger.info({ locationId, created: toCreate.length, failures }, 'Custom fields created');
  },

  async createCustomValues(api: ReturnType<typeof ghlApi> extends Promise<infer T> ? T : never, locationId: string): Promise<void> {
    let existingValues: Record<string, string> = {};
    try {
      const res = await api.get(`/locations/${locationId}/customValues`);
      const values = res.data.customValues || res.data || [];
      for (const v of values) {
        existingValues[v.name || v.fieldKey] = v.id;
      }
    } catch (err) {
      logger.warn({ err, locationId }, 'Could not fetch existing custom values');
    }

    const valuesToSet = [
      { name: GHL_CUSTOM_VALUES.BUSINESS_NAME, value: '' },
      { name: GHL_CUSTOM_VALUES.SUPPORT_EMAIL, value: '' },
      { name: GHL_CUSTOM_VALUES.TC_URL,        value: '' },
    ];

    let failures = 0;
    for (const cv of valuesToSet) {
      try {
        if (existingValues[cv.name]) {
          logger.debug({ locationId, name: cv.name }, 'Custom value already exists');
        } else {
          await api.post(`/locations/${locationId}/customValues`, {
            name: cv.name,
            value: cv.value,
          });
          logger.info({ locationId, name: cv.name }, 'Custom value created');
        }
      } catch (err: any) {
        const status = err.ghlStatus || err.status;
        if (status === 422 || status === 409) {
          logger.debug({ locationId, name: cv.name }, 'Custom value already exists (conflict)');
        } else {
          failures++;
          logger.warn({ err, locationId, name: cv.name }, 'Failed to create custom value (non-fatal)');
        }
      }
    }

    if (failures > Math.floor(valuesToSet.length / 2)) {
      throw new Error(`Too many custom value failures (${failures}/${valuesToSet.length}) — likely a systemic issue`);
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

    // Fetch GHL custom values to get current state (best-effort)
    let ghlValues: Record<string, string> = {};
    try {
      ghlValues = await this.readGhlCustomValues(locationId);
    } catch (err) {
      logger.warn({ err, locationId }, 'Could not fetch GHL custom values — using Supabase only');
    }

    const gv = (id: string) => ghlValues[id] || '';
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

      businessName: merchant.business_name || gv(CV.CV_BUSINESS_NAME) || '',
      dbaName: merchant.dba_name || gv(CV.CV_DBA_BRAND_NAME) || '',
      supportEmail: merchant.support_email || gv(CV.CV_SUPPORT_EMAIL) || '',
      descriptor: merchant.descriptor || gv(CV.CV_DESCRIPTOR) || '',
      businessWebsite: gv(CV.CV_BUSINESS_WEBSITE) || (cfg as any).business_website || '',
      businessCity: gv(CV.CV_BUSINESS_CITY) || (cfg as any).business_city || '',
      businessState: gv(CV.CV_BUSINESS_STATE) || (cfg as any).business_state || '',
      industryNiche: merchant.industry || gv(CV.CV_INDUSTRY_NICHE) || '',
      primaryServiceType: gv(CV.CV_PRIMARY_SERVICE_TYPE) || (cfg as any).primary_service_type || '',
      logoUrl: merchant.logo_url || gv(CV.CV_LOGO_URL) || '',
      shortDescription: gv(CV.CV_SHORT_DESCRIPTION) || (cfg as any).short_description || '',

      tcHasOwn: gv(CV.CV_TC_HAS_OWN) === 'true' || (cfg as any).tc_has_own === true,
      tcDocumentUrl: gv(CV.CV_TC_DOCUMENT_URL) || (cfg as any).tc_document_url || '',
      standardClauses: standardClauses as Record<StandardClauseKey, boolean>,
      customClause1Title: gv(CV.CV_CUSTOM_CLAUSE_1_TITLE) || (cfg as any).custom_clause_1_title || '',
      customClause1Text: gv(CV.CV_CUSTOM_CLAUSE_1_TEXT) || (cfg as any).custom_clause_1_text || '',
      customClause2Title: gv(CV.CV_CUSTOM_CLAUSE_2_TITLE) || (cfg as any).custom_clause_2_title || '',
      customClause2Text: gv(CV.CV_CUSTOM_CLAUSE_2_TEXT) || (cfg as any).custom_clause_2_text || '',

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
    if (updates.customClause1Title !== undefined) configUpdates.custom_clause_1_title = updates.customClause1Title;
    if (updates.customClause1Text !== undefined) configUpdates.custom_clause_1_text = updates.customClause1Text;
    if (updates.customClause2Title !== undefined) configUpdates.custom_clause_2_title = updates.customClause2Title;
    if (updates.customClause2Text !== undefined) configUpdates.custom_clause_2_text = updates.customClause2Text;

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
   * Sync config to GHL custom values using exact hardcoded IDs.
   * Uses PUT /locations/{locationId}/customValues/{id} for each value.
   */
  async syncConfigToGHL(locationId: string, updates: MerchantConfigUpdate, compiledHtml: string): Promise<void> {
    const api = await ghlApi(locationId);

    // Build list of {id, value} pairs to write
    const toSync: Array<{ id: string; value: string }> = [];

    // Business info
    if (updates.businessName !== undefined)      toSync.push({ id: CV.CV_BUSINESS_NAME, value: updates.businessName });
    if (updates.dbaName !== undefined)            toSync.push({ id: CV.CV_DBA_BRAND_NAME, value: updates.dbaName });
    if (updates.supportEmail !== undefined)       toSync.push({ id: CV.CV_SUPPORT_EMAIL, value: updates.supportEmail });
    if (updates.descriptor !== undefined)         toSync.push({ id: CV.CV_DESCRIPTOR, value: updates.descriptor });
    if (updates.businessWebsite !== undefined)    toSync.push({ id: CV.CV_BUSINESS_WEBSITE, value: updates.businessWebsite });
    if (updates.businessCity !== undefined)        toSync.push({ id: CV.CV_BUSINESS_CITY, value: updates.businessCity });
    if (updates.businessState !== undefined)       toSync.push({ id: CV.CV_BUSINESS_STATE, value: updates.businessState });
    if (updates.industryNiche !== undefined)       toSync.push({ id: CV.CV_INDUSTRY_NICHE, value: updates.industryNiche });
    if (updates.primaryServiceType !== undefined)  toSync.push({ id: CV.CV_PRIMARY_SERVICE_TYPE, value: updates.primaryServiceType });
    if (updates.logoUrl !== undefined)             toSync.push({ id: CV.CV_LOGO_URL, value: updates.logoUrl });
    if (updates.shortDescription !== undefined)    toSync.push({ id: CV.CV_SHORT_DESCRIPTION, value: updates.shortDescription });

    // T&C config
    if (updates.tcHasOwn !== undefined)            toSync.push({ id: CV.CV_TC_HAS_OWN, value: String(updates.tcHasOwn) });
    if (updates.tcDocumentUrl !== undefined)        toSync.push({ id: CV.CV_TC_DOCUMENT_URL, value: updates.tcDocumentUrl });
    if (updates.customClause1Title !== undefined)   toSync.push({ id: CV.CV_CUSTOM_CLAUSE_1_TITLE, value: updates.customClause1Title });
    if (updates.customClause1Text !== undefined)    toSync.push({ id: CV.CV_CUSTOM_CLAUSE_1_TEXT, value: updates.customClause1Text });
    if (updates.customClause2Title !== undefined)   toSync.push({ id: CV.CV_CUSTOM_CLAUSE_2_TITLE, value: updates.customClause2Title });
    if (updates.customClause2Text !== undefined)    toSync.push({ id: CV.CV_CUSTOM_CLAUSE_2_TEXT, value: updates.customClause2Text });

    // Always sync compiled T&C HTML
    toSync.push({ id: CV.CV_COMPILED_TERMS_HTML, value: compiledHtml });

    // Evidence module toggles
    if (updates.modules) {
      if (updates.modules.sessions !== undefined)   toSync.push({ id: CV.CV_MODULE_SESSIONS, value: updates.modules.sessions ? 'Enabled' : 'Disabled' });
      if (updates.modules.milestones !== undefined)  toSync.push({ id: CV.CV_MODULE_MILESTONES, value: updates.modules.milestones ? 'Enabled' : 'Disabled' });
      if (updates.modules.pulse !== undefined)       toSync.push({ id: CV.CV_MODULE_PULSE, value: updates.modules.pulse ? 'Enabled' : 'Disabled' });
      if (updates.modules.payments !== undefined)    toSync.push({ id: CV.CV_MODULE_PAYMENTS, value: updates.modules.payments ? 'Enabled' : 'Disabled' });
      if (updates.modules.course !== undefined)      toSync.push({ id: CV.CV_MODULE_COURSE, value: updates.modules.course ? 'Enabled' : 'Disabled' });
    }

    // Write in batches of 5 to avoid GHL rate limits
    let synced = 0;
    for (let i = 0; i < toSync.length; i += 5) {
      const batch = toSync.slice(i, i + 5);
      await Promise.all(batch.map(async ({ id, value }) => {
        try {
          await api.put(`/locations/${locationId}/customValues/${id}`, { value });
          synced++;
        } catch (err) {
          logger.warn({ err, locationId, customValueId: id }, 'Failed to update GHL custom value');
        }
      }));
    }

    logger.info({ locationId, synced, total: toSync.length }, 'GHL custom values synced');
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
