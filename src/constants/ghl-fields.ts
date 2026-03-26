/**
 * The 5 SS- contact fields the app actively manages (v2.1).
 * All other data lives in Supabase.
 */
export const SS_CONTACT_FIELDS = {
  ENROLLMENT_STATUS: 'contact.ss_enrollment_status',
  EVIDENCE_SCORE:    'contact.ss_evidence_score',
  LAST_EVIDENCE_DATE:'contact.ss_last_evidence_date',
  CHARGEBACK_STATUS: 'contact.ss_chargeback_status',
  DEFENSE_STATUS:    'contact.ss_defense_status',
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
 * GHL Custom Values set during onboarding.
 */
export const GHL_CUSTOM_VALUES = {
  BUSINESS_NAME: 'SS--Business-Name',
  SUPPORT_EMAIL: 'SS--Support-Email',
  TC_URL:        'SS--TC-URL',
} as const;

/**
 * Offers Custom Object key prefix for GHL API calls.
 */
export const GHL_OFFERS_OBJECT_KEY = 'custom_objects.offers';
