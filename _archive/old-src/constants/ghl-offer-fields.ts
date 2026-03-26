/**
 * ghl-offer-fields.ts — GHL Offers Custom Object Field Keys
 *
 * The Offers Custom Object stores coaching program definitions.
 * Each offer has: name, price, payment terms, up to 8 milestones,
 * 11 T&C clause slots, and metadata.
 *
 * Object key: custom_objects.offers
 * Required property: program_name
 * Total fields: 66
 *
 * Source: docs/ghl-offers-custom-object-schema.md (pulled from live GHL account)
 */

/** The Custom Object key prefix for all offer fields. */
export const OFFER_OBJECT_KEY = 'custom_objects.offers';

// ============================================
// CORE OFFER FIELDS
// ============================================

export const OFFER = {
  PROGRAM_NAME: 'custom_objects.offers.program_name',
  PRICE: 'custom_objects.offers.price',
  INSTALLMENT_AMOUNT: 'custom_objects.offers.installment_amount',
  NUMBER_OF_PAYMENTS: 'custom_objects.offers.number_of_payments',
  PIF_PRICE: 'custom_objects.offers.pif_price',
  PROGRAM_DESCRIPTION: 'custom_objects.offers.program_description',
  PAYMENT_TYPE: 'custom_objects.offers.payment_type',                 // Options: One-Time, Installments
  INSTALLMENT_FREQUENCY: 'custom_objects.offers.installment_frequency', // Options: Weekly, Bi-Weekly, Monthly
  PIF_DISCOUNT_ENABLED: 'custom_objects.offers.pif_discount_enabled', // Options: Yes, No
  ACTIVE: 'custom_objects.offers.active',                             // Options: Yes, No
  DELIVERY_METHOD: 'custom_objects.offers.delivery_method',           // Options: Live Virtual, In-Person, Self-Paced, Hybrid, Digital Download, Other
  REDIRECT_SLUG: 'custom_objects.offers.redirect_slug',
  PRICE_DISPLAY: 'custom_objects.offers.price_display',
  OFFER_CREATED_DATE: 'custom_objects.offers.offer_created_date',
  CONTACT_ID: 'custom_objects.offers.contact_id',
  REFUND_WINDOW_TEXT: 'custom_objects.offers.refund_window_text',
  COMPILED_TC_HTML: 'custom_objects.offers.compiled_tc_html',
} as const;

// ============================================
// MILESTONE FIELDS (8 milestones × 3 fields each = 24 fields)
// ============================================

/** Milestone fields for milestones 1-8. Each has name, delivers, and client_does. */
export const OFFER_MILESTONES = [
  {
    name: 'custom_objects.offers.m1_name',
    delivers: 'custom_objects.offers.m1_delivers',
    clientDoes: 'custom_objects.offers.m1_client_does',
  },
  {
    name: 'custom_objects.offers.m2_name',
    delivers: 'custom_objects.offers.m2_delivers',
    clientDoes: 'custom_objects.offers.m2_client_does',
  },
  {
    name: 'custom_objects.offers.m3_name',
    delivers: 'custom_objects.offers.m3_delivers',
    clientDoes: 'custom_objects.offers.m3_client_does',
  },
  {
    name: 'custom_objects.offers.m4_name',
    delivers: 'custom_objects.offers.m4_delivers',
    clientDoes: 'custom_objects.offers.m4_client_does',
  },
  {
    name: 'custom_objects.offers.m5_name',
    delivers: 'custom_objects.offers.m5_delivers',
    clientDoes: 'custom_objects.offers.m5_client_does',
  },
  {
    name: 'custom_objects.offers.m6_name',
    delivers: 'custom_objects.offers.m6_delivers',
    clientDoes: 'custom_objects.offers.m6_client_does',
  },
  {
    name: 'custom_objects.offers.m7_name',
    delivers: 'custom_objects.offers.m7_delivers',
    clientDoes: 'custom_objects.offers.m7_client_does',
  },
  {
    name: 'custom_objects.offers.m8_name',
    delivers: 'custom_objects.offers.m8_delivers',
    clientDoes: 'custom_objects.offers.m8_client_does',
  },
] as const;

// ============================================
// T&C CLAUSE SLOTS (11 slots × 2 fields each = 22 fields)
// 9 standard clauses + 2 custom per offer
// ============================================

/** T&C clause slot fields. Each has a title and text. */
export const OFFER_CLAUSE_SLOTS = [
  { title: 'custom_objects.offers.clause_slot_1_title', text: 'custom_objects.offers.clause_slot_1_text' },
  { title: 'custom_objects.offers.clause_slot_2_title', text: 'custom_objects.offers.clause_slot_2_text' },
  { title: 'custom_objects.offers.clause_slot_3_title', text: 'custom_objects.offers.clause_slot_3_text' },
  { title: 'custom_objects.offers.clause_slot_4_title', text: 'custom_objects.offers.clause_slot_4_text' },
  { title: 'custom_objects.offers.clause_slot_5_title', text: 'custom_objects.offers.clause_slot_5_text' },
  { title: 'custom_objects.offers.clause_slot_6_title', text: 'custom_objects.offers.clause_slot_6_text' },
  { title: 'custom_objects.offers.clause_slot_7_title', text: 'custom_objects.offers.clause_slot_7_text' },
  { title: 'custom_objects.offers.clause_slot_8_title', text: 'custom_objects.offers.clause_slot_8_text' },
  { title: 'custom_objects.offers.clause_slot_9_title', text: 'custom_objects.offers.clause_slot_9_text' },
  { title: 'custom_objects.offers.clause_slot_10_title', text: 'custom_objects.offers.clause_slot_10_text' },
  { title: 'custom_objects.offers.clause_slot_11_title', text: 'custom_objects.offers.clause_slot_11_text' },
] as const;
