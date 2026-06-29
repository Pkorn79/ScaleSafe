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

/**
 * Workflow-compatible offer fields.
 *
 * These duplicate some canonical offer values because the current PMG workflow
 * email/SMS templates were built from older instruction docs that use these
 * names. For beta, workflows win: the app writes both canonical fields and
 * these aliases before the workflow trigger fires.
 */
export const WORKFLOW_COMPAT_OFFER_CONTACT_FIELDS = {
  PROGRAM_NAME:       'contact.offer_program_name',
  PRICE_DISPLAY:      'contact.offer_price_display',
  NUMBER_OF_PAYMENTS: 'contact.offer_number_of_payments',
  SUPPORT_EMAIL:      'contact.offer_support_email',
  REFUND_POLICY:      'contact.offer_refund_policy',
  TC_DOCUMENT_URL:    'contact.offer_tc_document_url',
} as const;

/**
 * Payment/refund fields used by existing workflow copy.
 */
export const WORKFLOW_PAYMENT_CONTACT_FIELDS = {
  BILLING_FREQUENCY:         'contact.ss_billing_frequency',
  PAYMENT_STATUS:            'contact.ss_payment_status',
  LAST_PAYMENT_AMOUNT:       'contact.ss_last_payment_amount',
  LAST_PAYMENT_DATE:         'contact.ss_last_payment_date',
  NEXT_PAYMENT_DATE:         'contact.ss_next_payment_date',
  PAYMENTS_MADE:             'contact.ss_payments_made',
  PAYMENTS_REMAINING:        'contact.ss_payments_remaining',
  PAYMENT_GRACE_PERIOD_END:  'contact.ss_payment_grace_period_end',
  REFUND_AMOUNT:             'contact.ss_refund_amount',
  REFUND_DATE:               'contact.ss_refund_date',
  REFUND_TRANSACTION_ID:     'contact.ss_refund_transaction_id',
  REMAINING_BALANCE:         'contact.ss_remaining_balance',
  SUBSCRIPTION_START:        'contact.ss_subscription_start',
  SUCCESSFUL_PAYMENT_COUNT:  'contact.ss_successful_payment_count',
  TOTAL_CONTRACT_VALUE:      'contact.ss_total_contract_value',
  TOTAL_PAID:                'contact.ss_total_paid',
  FAILED_PAYMENT_COUNT:      'contact.ss_failed_payment_count',
  LAST_FAILED_PAYMENT_DATE:  'contact.ss_last_failed_payment_date',
} as const;

export const WORKFLOW_PULSE_CONTACT_FIELDS = {
  CHECK_URL:      'contact.ss_pulse_check_url',
  DUE_DATE:       'contact.ss_pulse_due_date',
  INTERVAL_LABEL: 'contact.ss_pulse_interval_label',
  LAST_SENT_AT:   'contact.ss_last_pulse_sent_at',
} as const;

export const WORKFLOW_MILESTONE_CONTACT_FIELDS = {
  CURRENT_MILESTONE_NAME:     'contact.ss_current_milestone_name',
  SIGNOFF_LINK:               'contact.sign_off_link',
  SIGNOFF_MILESTONE_NAME:     'contact.ss_signoff_milestone_name',
  SIGNOFF_MILESTONE_NUMBER:   'contact.ss_signoff_milestone_number',
  SIGNOFF_WORK_SUMMARY:       'contact.ss_signoff_work_summary',
} as const;

export const WORKFLOW_DEFENSE_CONTACT_FIELDS = {
  CHARGEBACK_REASON_CODE: 'contact.ss_chargeback_reason_code',
  DEFENSE_PACKET_URL:    'contact.ss_defense_packet_url',
  DEFENSE_PDF_URL:       'contact.ss_defense_pdf_url',
} as const;

export const WORKFLOW_EVIDENCE_CONTACT_FIELDS = {
  LAST_SESSION_DURATION: 'contact.ss_last_session_duration',
  LAST_SESSION_TOPIC:    'contact.ss_last_session_topic',
  NO_SHOW_COUNT:         'contact.ss_no_show_count',
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

export interface CustomFieldDef {
  name: string;
  fieldKey: string;
  dataType: 'TEXT' | 'LARGE_TEXT' | 'NUMERICAL';
}

function keyWithoutContactPrefix(field: string): string {
  return field.replace(/^contact\./, '');
}

function textField(name: string, field: string): CustomFieldDef {
  return { name, fieldKey: keyWithoutContactPrefix(field), dataType: 'TEXT' };
}

function largeTextField(name: string, field: string): CustomFieldDef {
  return { name, fieldKey: keyWithoutContactPrefix(field), dataType: 'LARGE_TEXT' };
}

function numberField(name: string, field: string): CustomFieldDef {
  return { name, fieldKey: keyWithoutContactPrefix(field), dataType: 'NUMERICAL' };
}

export const BETA_CUSTOM_FIELD_REGISTRY: readonly CustomFieldDef[] = [
  textField('SS Enrollment Status', SS_CONTACT_FIELDS.ENROLLMENT_STATUS),
  numberField('SS Evidence Score', SS_CONTACT_FIELDS.EVIDENCE_SCORE),
  textField('SS Last Evidence Date', SS_CONTACT_FIELDS.LAST_EVIDENCE_DATE),
  textField('SS Chargeback Status', SS_CONTACT_FIELDS.CHARGEBACK_STATUS),
  textField('SS Defense Status', SS_CONTACT_FIELDS.DEFENSE_STATUS),
  textField('SS Engagement Status', SS_CONTACT_FIELDS.ENGAGEMENT_STATUS),

  textField('Offer Business Name', OFFER_CONTACT_FIELDS.BUSINESS_NAME),
  textField('Offer Name', OFFER_CONTACT_FIELDS.OFFER_NAME),
  textField('Offer Price', OFFER_CONTACT_FIELDS.PRICE),
  textField('Offer Payment Type', OFFER_CONTACT_FIELDS.PAYMENT_TYPE),
  textField('Offer Installment Amount', OFFER_CONTACT_FIELDS.INSTALLMENT_AMOUNT),
  textField('Offer Installment Frequency', OFFER_CONTACT_FIELDS.INSTALLMENT_FREQUENCY),
  textField('Offer Num Payments', OFFER_CONTACT_FIELDS.NUM_PAYMENTS),

  textField('Offer Program Name', WORKFLOW_COMPAT_OFFER_CONTACT_FIELDS.PROGRAM_NAME),
  textField('Offer Price Display', WORKFLOW_COMPAT_OFFER_CONTACT_FIELDS.PRICE_DISPLAY),
  textField('Offer Number of Payments', WORKFLOW_COMPAT_OFFER_CONTACT_FIELDS.NUMBER_OF_PAYMENTS),
  textField('Offer Support Email', WORKFLOW_COMPAT_OFFER_CONTACT_FIELDS.SUPPORT_EMAIL),
  largeTextField('Offer Refund Policy', WORKFLOW_COMPAT_OFFER_CONTACT_FIELDS.REFUND_POLICY),
  textField('Offer TC Document URL', WORKFLOW_COMPAT_OFFER_CONTACT_FIELDS.TC_DOCUMENT_URL),

  textField('SS Billing Frequency', WORKFLOW_PAYMENT_CONTACT_FIELDS.BILLING_FREQUENCY),
  textField('SS Payment Status', WORKFLOW_PAYMENT_CONTACT_FIELDS.PAYMENT_STATUS),
  textField('SS Last Payment Amount', WORKFLOW_PAYMENT_CONTACT_FIELDS.LAST_PAYMENT_AMOUNT),
  textField('SS Last Payment Date', WORKFLOW_PAYMENT_CONTACT_FIELDS.LAST_PAYMENT_DATE),
  textField('SS Next Payment Date', WORKFLOW_PAYMENT_CONTACT_FIELDS.NEXT_PAYMENT_DATE),
  numberField('SS Payments Made', WORKFLOW_PAYMENT_CONTACT_FIELDS.PAYMENTS_MADE),
  numberField('SS Payments Remaining', WORKFLOW_PAYMENT_CONTACT_FIELDS.PAYMENTS_REMAINING),
  textField('SS Payment Grace Period End', WORKFLOW_PAYMENT_CONTACT_FIELDS.PAYMENT_GRACE_PERIOD_END),
  textField('SS Refund Amount', WORKFLOW_PAYMENT_CONTACT_FIELDS.REFUND_AMOUNT),
  textField('SS Refund Date', WORKFLOW_PAYMENT_CONTACT_FIELDS.REFUND_DATE),
  textField('SS Refund Transaction ID', WORKFLOW_PAYMENT_CONTACT_FIELDS.REFUND_TRANSACTION_ID),
  textField('SS Remaining Balance', WORKFLOW_PAYMENT_CONTACT_FIELDS.REMAINING_BALANCE),
  textField('SS Subscription Start', WORKFLOW_PAYMENT_CONTACT_FIELDS.SUBSCRIPTION_START),
  numberField('SS Successful Payment Count', WORKFLOW_PAYMENT_CONTACT_FIELDS.SUCCESSFUL_PAYMENT_COUNT),
  textField('SS Total Contract Value', WORKFLOW_PAYMENT_CONTACT_FIELDS.TOTAL_CONTRACT_VALUE),
  textField('SS Total Paid', WORKFLOW_PAYMENT_CONTACT_FIELDS.TOTAL_PAID),
  numberField('SS Failed Payment Count', WORKFLOW_PAYMENT_CONTACT_FIELDS.FAILED_PAYMENT_COUNT),
  textField('SS Last Failed Payment Date', WORKFLOW_PAYMENT_CONTACT_FIELDS.LAST_FAILED_PAYMENT_DATE),

  textField('SS Pulse Check URL', WORKFLOW_PULSE_CONTACT_FIELDS.CHECK_URL),
  textField('SS Pulse Due Date', WORKFLOW_PULSE_CONTACT_FIELDS.DUE_DATE),
  textField('SS Pulse Interval Label', WORKFLOW_PULSE_CONTACT_FIELDS.INTERVAL_LABEL),
  textField('SS Last Pulse Sent At', WORKFLOW_PULSE_CONTACT_FIELDS.LAST_SENT_AT),

  textField('SS Current Milestone Name', WORKFLOW_MILESTONE_CONTACT_FIELDS.CURRENT_MILESTONE_NAME),
  textField('Sign Off Link', WORKFLOW_MILESTONE_CONTACT_FIELDS.SIGNOFF_LINK),
  textField('SS Sign-Off Milestone Name', WORKFLOW_MILESTONE_CONTACT_FIELDS.SIGNOFF_MILESTONE_NAME),
  textField('SS Sign-Off Milestone Number', WORKFLOW_MILESTONE_CONTACT_FIELDS.SIGNOFF_MILESTONE_NUMBER),
  largeTextField('SS Sign-Off Work Summary', WORKFLOW_MILESTONE_CONTACT_FIELDS.SIGNOFF_WORK_SUMMARY),

  textField('SS Chargeback Reason Code', WORKFLOW_DEFENSE_CONTACT_FIELDS.CHARGEBACK_REASON_CODE),
  textField('SS Defense Packet URL', WORKFLOW_DEFENSE_CONTACT_FIELDS.DEFENSE_PACKET_URL),
  textField('SS Defense PDF URL', WORKFLOW_DEFENSE_CONTACT_FIELDS.DEFENSE_PDF_URL),

  textField('SS Last Session Duration', WORKFLOW_EVIDENCE_CONTACT_FIELDS.LAST_SESSION_DURATION),
  textField('SS Last Session Topic', WORKFLOW_EVIDENCE_CONTACT_FIELDS.LAST_SESSION_TOPIC),
  numberField('SS No Show Count', WORKFLOW_EVIDENCE_CONTACT_FIELDS.NO_SHOW_COUNT),

  ...OFFER_CLAUSE_FIELDS.flatMap((slot, i) => [
    textField(`Offer Clause ${i + 1} Title`, slot.title),
    largeTextField(`Offer Clause ${i + 1} Text`, slot.text),
  ]),
  ...OFFER_MILESTONE_FIELDS.flatMap((slot, i) => [
    textField(`Offer Milestone ${i + 1} Name`, slot.name),
    largeTextField(`Offer Milestone ${i + 1} Description`, slot.description),
  ]),
] as const;

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
] as const;
