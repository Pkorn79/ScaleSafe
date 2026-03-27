import { ghlApi } from '../clients/ghl.client';
import { merchantRepository } from '../repositories/merchant.repository';
import { logger } from '../utils/logger';
import {
  SS_CONTACT_FIELDS,
  OFFER_CONTACT_FIELDS,
  OFFER_CLAUSE_FIELDS,
  OFFER_MILESTONE_FIELDS,
  CUSTOM_TRIGGERS,
  GHL_CUSTOM_VALUES,
} from '../constants/ghl-fields';

// Pipeline stage definitions per the GHL Automation Companion
const PIPELINE_STAGES = [
  'Enrolled',
  'Milestone 1',
  'Milestone 2',
  'Milestone 3',
  'Milestone 4',
  'Milestone 5',
  'Milestone 6',
  'Completed',
];

// Custom field definitions to create via API
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
  // 11 clause slots (title + text)
  ...Array.from({ length: 11 }, (_, i) => [
    { name: `Offer Clause ${i + 1} Title`, fieldKey: `offer_clause_slot_${i + 1}_title`, dataType: 'TEXT' },
    { name: `Offer Clause ${i + 1} Text`,  fieldKey: `offer_clause_slot_${i + 1}_text`,  dataType: 'TEXT' },
  ]).flat(),
  // 8 milestone slots (name + description)
  ...Array.from({ length: 8 }, (_, i) => [
    { name: `Offer Milestone ${i + 1} Name`,        fieldKey: `offer_milestone_${i + 1}_name`,        dataType: 'TEXT' },
    { name: `Offer Milestone ${i + 1} Description`,  fieldKey: `offer_milestone_${i + 1}_description`, dataType: 'TEXT' },
  ]).flat(),
];

export const merchantService = {
  /**
   * Full provisioning flow after OAuth — creates all GHL components.
   * Runs asynchronously after the OAuth callback returns.
   * Tracks status in snapshot_status / snapshot_attempts / snapshot_error.
   */
  async provisionMerchant(locationId: string): Promise<void> {
    logger.info({ locationId }, 'Starting merchant provisioning');
    await merchantRepository.updateSnapshotStatus(locationId, 'installing');

    try {
      const api = await ghlApi(locationId);

      // Run independent steps in parallel where possible
      const [pipelineId] = await Promise.all([
        this.createPipeline(api, locationId),
        this.createCustomFields(api, locationId),
        this.createCustomValues(api, locationId),
      ]);

      // Triggers depend on having the API ready (no dependency on above, but sequential for clarity)
      const triggerIds = await this.registerCustomTriggers(api, locationId);

      // Store pipeline ID in config and trigger IDs
      const merchant = await merchantRepository.getByLocationId(locationId);
      const updatedConfig = { ...merchant.config, pipelineId };
      await merchantRepository.update(locationId, { config: updatedConfig } as any);
      await merchantRepository.updateTriggerIds(locationId, triggerIds);

      await merchantRepository.updateSnapshotStatus(locationId, 'installed');
      logger.info({ locationId, pipelineId, triggerCount: Object.keys(triggerIds).length }, 'Merchant provisioning complete');
    } catch (err: any) {
      logger.error({ err, locationId }, 'Merchant provisioning failed');
      await merchantRepository.updateSnapshotStatus(locationId, 'failed', err.message);

      // Check if we should retry (max 3 attempts)
      const merchant = await merchantRepository.getByLocationId(locationId);
      if (merchant.snapshot_attempts < 3) {
        const delay = Math.pow(2, merchant.snapshot_attempts) * 5000; // 5s, 10s, 20s
        logger.info({ locationId, attempt: merchant.snapshot_attempts, retryIn: delay }, 'Scheduling provisioning retry');
        setTimeout(() => this.provisionMerchant(locationId), delay);
      } else {
        logger.error({ locationId, attempts: merchant.snapshot_attempts }, 'Provisioning failed after max retries');
      }
    }
  },

  /**
   * Create the Client Milestones pipeline with 8 stages.
   * Returns the pipeline ID.
   */
  async createPipeline(api: ReturnType<typeof ghlApi> extends Promise<infer T> ? T : never, locationId: string): Promise<string> {
    // Check if pipeline already exists
    try {
      const listRes = await api.get('/opportunities/pipelines', { params: { locationId } });
      const pipelines = listRes.data.pipelines || listRes.data || [];
      const existing = pipelines.find((p: any) => p.name === 'Client Milestones');
      if (existing) {
        logger.info({ locationId, pipelineId: existing.id }, 'Client Milestones pipeline already exists');
        return existing.id;
      }
    } catch (err) {
      logger.warn({ err, locationId }, 'Could not list existing pipelines, creating new one');
    }

    const stages = PIPELINE_STAGES.map((name, i) => ({
      name,
      position: i,
    }));

    const res = await api.post('/opportunities/pipelines', {
      name: 'Client Milestones',
      locationId,
      stages,
    });

    const pipelineId = res.data.pipeline?.id || res.data.id;
    logger.info({ locationId, pipelineId }, 'Client Milestones pipeline created');
    return pipelineId;
  },

  /**
   * Create the 5 SS- contact fields and ~45 Offer-prefix fields.
   * Idempotent: checks existing fields first, only creates missing ones.
   */
  async createCustomFields(api: ReturnType<typeof ghlApi> extends Promise<infer T> ? T : never, locationId: string): Promise<void> {
    // Fetch existing custom fields
    let existingKeys = new Set<string>();
    try {
      const res = await api.get('/locations/custom-fields', { params: { locationId } });
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

    // Create fields in batches of 5 to avoid rate limiting
    for (let i = 0; i < toCreate.length; i += 5) {
      const batch = toCreate.slice(i, i + 5);
      await Promise.all(batch.map(async (field) => {
        try {
          await api.post('/locations/custom-fields', {
            name: field.name,
            dataType: field.dataType,
            locationId,
          });
        } catch (err: any) {
          // Field might already exist with a different key format — non-fatal
          if (err.status === 422 || err.status === 409) {
            logger.debug({ field: field.name, locationId }, 'Custom field already exists (conflict)');
          } else {
            throw err;
          }
        }
      }));
    }

    logger.info({ locationId, created: toCreate.length }, 'Custom fields created');
  },

  /**
   * Set the 3 SS-- custom values for the location.
   * These are location-level settings that GHL workflows reference.
   */
  async createCustomValues(api: ReturnType<typeof ghlApi> extends Promise<infer T> ? T : never, locationId: string): Promise<void> {
    // Fetch existing custom values
    let existingValues: Record<string, string> = {};
    try {
      const res = await api.get('/locations/customValues', { params: { locationId } });
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

    for (const cv of valuesToSet) {
      try {
        if (existingValues[cv.name]) {
          // Already exists — skip (merchant will set value later)
          logger.debug({ locationId, name: cv.name }, 'Custom value already exists');
        } else {
          await api.post('/locations/customValues', {
            name: cv.name,
            value: cv.value,
            locationId,
          });
          logger.info({ locationId, name: cv.name }, 'Custom value created');
        }
      } catch (err: any) {
        if (err.status === 422 || err.status === 409) {
          logger.debug({ locationId, name: cv.name }, 'Custom value already exists (conflict)');
        } else {
          throw err;
        }
      }
    }
  },

  /**
   * Register the 5 custom workflow triggers for this location.
   * Returns a map of trigger name → trigger ID.
   */
  async registerCustomTriggers(
    api: ReturnType<typeof ghlApi> extends Promise<infer T> ? T : never,
    locationId: string,
  ): Promise<Record<string, string>> {
    const triggerIds: Record<string, string> = {};

    for (const [key, triggerName] of Object.entries(CUSTOM_TRIGGERS)) {
      try {
        const res = await api.post('/custom-workflow-triggers', {
          name: triggerName,
          locationId,
        });
        const triggerId = res.data.trigger?.id || res.data.id || '';
        triggerIds[key] = triggerId;
        logger.info({ locationId, triggerName, triggerId }, 'Custom trigger registered');
      } catch (err: any) {
        // Trigger may already exist — try to find it
        if (err.status === 422 || err.status === 409) {
          logger.info({ locationId, triggerName }, 'Custom trigger already exists');
          try {
            const listRes = await api.get('/custom-workflow-triggers', { params: { locationId } });
            const triggers = listRes.data.triggers || listRes.data || [];
            const existing = triggers.find((t: any) => t.name === triggerName);
            if (existing) {
              triggerIds[key] = existing.id;
            }
          } catch {
            // Non-fatal — we just won't have the trigger ID cached
            logger.warn({ locationId, triggerName }, 'Could not look up existing trigger ID');
          }
        } else {
          throw err;
        }
      }
    }

    logger.info({ locationId, count: Object.keys(triggerIds).length }, 'Custom triggers registered');
    return triggerIds;
  },

  /**
   * Fetch location info from GHL to populate merchant business details.
   */
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
};
