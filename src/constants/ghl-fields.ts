/**
 * The 6 SS- contact fields the app actively manages (v2.1).
 * All other data lives in Supabase.
 */
export const SS_CONTACT_FIELDS = {
  ENROLLMENT_STATUS:  'contact.ss_enrollment_status',
  EVIDENCE_SCORE:     'contact.ss_evidence_score',
  LAST_EVIDENCE_DATE: 'contact.ss_last_evidence_date',
  CHARGEBACK_STATUS:  'contact.ss_chargeback_status',
  DEFENSE_STATUS:     'contact.ss_defense_status',
  ENGAGEMENT_STATUS:  'contact.ss_engagement_status',
} as const;

/**
 * Offer-prefix contact fields — written ONCE at enrollment time.
 * Copied from the Offers Custom Object to the contact record.
 */
export const OFFER_CONTACT_FIELDS = {
  BUSINESS_NAME:          'contact.offer_business_name',
  OFFER_NAME:             'contact.offer_name',
  PRICE:                  'contact.offer_price',
  PAYMENT_TYPE:           'contact.offer_payment_type',
  INSTALLMENT_AMOUNT:     'contact.offer_installment_amount',
  INSTALLMENT_FREQUENCY:  'contact.offer_installment_frequency',
  NUM_PAYMENTS:           'contact.offer_num_payments',
} as const;

// Clause slots 1-11
export const OFFER_CLAUSE_FIELDS = Array.from({ length: 11 }, (_, i) => ({
  title: `contact.offer_clause_slot_${i + 1}_title`,
  text:  `contact.offer_clause_slot_${i + 1}_text`,
}));

// Milestone slots 1-8
export const OFFER_MILESTONE_FIELDS = Array.from({ length: 8 }, (_, i) => ({
  name:        `contact.offer_milestone_${i + 1}_name`,
  description: `contact.offer_milestone_${i + 1}_description`,
}));

/**
 * Custom workflow trigger names registered on install.
 */
export const CUSTOM_TRIGGERS = {
  CHARGEBACK_DETECTED: 'Chargeback Detected',
  DEFENSE_READY:       'Defense Ready',
  EVIDENCE_MILESTONE:  'Evidence Milestone',
  CLIENT_AT_RISK:      'Client At Risk',
  PAYMENT_FAILED:      'Payment Failed',
} as const;

/**
 * Canonical custom value registry — maps each ScaleSafe custom value to its
 * fieldKey pattern (the part GHL auto-generates, consistent across locations
 * regardless of display name).
 *
 * fieldKeyMatch values verified against live GHL API data (2026-04-02).
 * During provisioning, values are matched by fieldKey pattern, NOT by name.
 * Each merchant's discovered IDs are stored in merchants.custom_value_ids.
 */
export interface CustomValueDef {
  key: string;
  defaultName: string;
  fieldKeyMatch: string;
}

export const CUSTOM_VALUE_REGISTRY: readonly CustomValueDef[] = [
  // Business Info (11)
  { key: 'BUSINESS_NAME',        defaultName: 'Business Legal Name',        fieldKeyMatch: 'merchant_business_name' },
  { key: 'DBA_BRAND_NAME',       defaultName: 'DBA / Brand Name',           fieldKeyMatch: 'dba__brand_name' },
  { key: 'SUPPORT_EMAIL',        defaultName: 'Merchant Support Email',     fieldKeyMatch: 'merchant_support_email' },
  { key: 'DESCRIPTOR',           defaultName: 'Merchant Descriptor',        fieldKeyMatch: 'merchant_descriptor' },
  { key: 'BUSINESS_WEBSITE',     defaultName: 'Business Website',           fieldKeyMatch: 'business_website' },
  { key: 'BUSINESS_CITY',        defaultName: 'Business City',              fieldKeyMatch: 'business_city' },
  { key: 'BUSINESS_STATE',       defaultName: 'Business State',             fieldKeyMatch: 'business_state' },
  { key: 'INDUSTRY_NICHE',       defaultName: 'Industry / Niche',           fieldKeyMatch: 'industry__niche' },
  { key: 'PRIMARY_SERVICE_TYPE', defaultName: 'Primary Service Type',       fieldKeyMatch: 'primary_service_type' },
  { key: 'LOGO_URL',             defaultName: 'SS Merchant Logo URL',       fieldKeyMatch: 'ss_merchant_logo_url' },
  { key: 'SHORT_DESCRIPTION',    defaultName: 'Short Business Description', fieldKeyMatch: 'short_business_description' },
  // T&C Config (7)
  { key: 'TC_HAS_OWN',            defaultName: 'TC Has Own',                fieldKeyMatch: 'tc_has_own' },
  { key: 'TC_DOCUMENT_URL',       defaultName: 'TC Document URL',           fieldKeyMatch: 'tc_document_url' },
  // REMOVED: COMPILED_TERMS_HTML, CUSTOM_CLAUSE_1/2_TITLE/TEXT — moved to per-offer (offers_mirror table)
  // Enrollment Funnel (1)
  { key: 'WEBSITE_BASE_URL',  defaultName: 'Website Base URL',          fieldKeyMatch: 'website_base_url' },
  // Evidence Module Toggles (5)
  { key: 'MODULE_SESSIONS',   defaultName: 'Module Session Tracking',   fieldKeyMatch: 'module_session_tracking' },
  { key: 'MODULE_MILESTONES', defaultName: 'Module Milestone Tracking', fieldKeyMatch: 'module_milestone_tracking' },
  { key: 'MODULE_PULSE',      defaultName: 'Module Pulse Check',        fieldKeyMatch: 'module_pulse_check' },
  { key: 'MODULE_PAYMENTS',   defaultName: 'Module Payment Tracking',   fieldKeyMatch: 'module_payment_tracking' },
  { key: 'MODULE_COURSE',     defaultName: 'Module Course Progress',    fieldKeyMatch: 'module_course_progress' },
  // Workflow security
  { key: 'WEBHOOK_SECRET',     defaultName: 'ScaleSafe Webhook Secret',  fieldKeyMatch: 'scalesafe_webhook_secret' },
  // Pulse cadence runtime config
  { key: 'PULSE_WORKFLOW_WEBHOOK_URL', defaultName: 'ScaleSafe Pulse Workflow Webhook URL', fieldKeyMatch: 'scalesafe_pulse_workflow_webhook_url' },
  { key: 'PULSE_FORM_URL',             defaultName: 'ScaleSafe Pulse Form URL',             fieldKeyMatch: 'scalesafe_pulse_form_url' },
] as const;
