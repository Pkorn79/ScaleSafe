import { ghlApi } from '../clients/ghl.client';
import { merchantRepository } from '../repositories/merchant.repository';
import { logger } from '../utils/logger';
import {
  GHL_CUSTOM_VALUES,
} from '../constants/ghl-fields';

// The 5 SS- contact fields the app manages (v2.1)
const SS_FIELDS_TO_CREATE = [
  { name: 'SS Enrollment Status',  fieldKey: 'ss_enrollment_status',  dataType: 'TEXT' },
  { name: 'SS Evidence Score',     fieldKey: 'ss_evidence_score',     dataType: 'NUMERICAL' },
  { name: 'SS Last Evidence Date', fieldKey: 'ss_last_evidence_date', dataType: 'TEXT' },
  { name: 'SS Chargeback Status',  fieldKey: 'ss_chargeback_status',  dataType: 'TEXT' },
  { name: 'SS Defense Status',     fieldKey: 'ss_defense_status',     dataType: 'TEXT' },
];

// Offer-prefix contact fields — written once at enrollment
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
   * Full provisioning flow after OAuth — creates GHL components that CAN
   * be created via API. Pipeline and custom triggers are NOT available via
   * the GHL API — they come from the Snapshot or Marketplace app config.
   */
  async provisionMerchant(locationId: string): Promise<void> {
    logger.info({ locationId }, 'Starting merchant provisioning');
    await merchantRepository.updateSnapshotStatus(locationId, 'installing');

    try {
      const api = await ghlApi(locationId);

      // Run independent API-creatable steps in parallel
      const [pipelineId] = await Promise.all([
        this.findPipeline(api, locationId),
        this.createCustomFields(api, locationId),
        this.createCustomValues(api, locationId),
      ]);

      // Store pipeline ID in config (if found from Snapshot)
      const merchant = await merchantRepository.getByLocationId(locationId);
      const updatedConfig = { ...merchant.config, pipelineId: pipelineId || null };
      await merchantRepository.update(locationId, { config: updatedConfig } as any);

      await merchantRepository.updateSnapshotStatus(locationId, 'installed');
      logger.info({ locationId, pipelineId }, 'Merchant provisioning complete');
    } catch (err: any) {
      logger.error({ err, locationId }, 'Merchant provisioning failed');
      await merchantRepository.updateSnapshotStatus(locationId, 'failed', err.message);

      // Check if we should retry (max 3 attempts)
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
   * Look up the Client Milestones pipeline (created by Snapshot, not API).
   * Returns pipeline ID if found, null if not yet installed.
   */
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

  /**
   * Create the 5 SS- contact fields and ~45 Offer-prefix fields.
   * Uses GHL v2 Custom Fields API: POST /custom-fields/
   * Idempotent: checks existing fields first, only creates missing ones.
   */
  async createCustomFields(api: ReturnType<typeof ghlApi> extends Promise<infer T> ? T : never, locationId: string): Promise<void> {
    // Fetch existing contact custom fields via v2 endpoint
    let existingKeys = new Set<string>();
    try {
      const res = await api.get('/custom-fields/object-key/contact', { params: { locationId } });
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
          await api.post('/custom-fields/', {
            name: field.name,
            dataType: field.dataType,
            fieldKey: field.fieldKey,
            objectKey: 'contact',
            locationId,
            showInForms: false,
          });
        } catch (err: any) {
          // Field might already exist — non-fatal
          const status = err.ghlStatus || err.status;
          if (status === 422 || status === 409) {
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
   * Uses GHL v2 Custom Values API: /locations/{locationId}/customValues
   */
  async createCustomValues(api: ReturnType<typeof ghlApi> extends Promise<infer T> ? T : never, locationId: string): Promise<void> {
    // Fetch existing custom values — locationId in path, not query
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

    for (const cv of valuesToSet) {
      try {
        if (existingValues[cv.name]) {
          logger.debug({ locationId, name: cv.name }, 'Custom value already exists');
        } else {
          // locationId in path, not body
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
          throw err;
        }
      }
    }
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
