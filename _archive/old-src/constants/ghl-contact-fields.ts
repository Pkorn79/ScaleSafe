/**
 * ghl-contact-fields.ts — GHL Contact-Level Custom Fields
 *
 * Every enrolled client has these custom fields on their GHL contact record.
 * There are 352 total fields across 27 categories. This file contains the ones
 * that ScaleSafe actively reads or writes during its operations.
 *
 * Each constant has:
 * - id: The GHL field ID (used for API calls that require field IDs)
 * - key: The field key path (used for reading/writing field values)
 *
 * Fields are organized by functional group, not by GHL category,
 * because that's how the app uses them.
 *
 * Source: docs/ghl-custom-fields-reference.md (pulled from live GHL account)
 */

interface ContactField {
  id: string;
  key: string;
}

// ============================================
// SS TRACKING FIELDS (system-managed)
// ============================================

export const SS_CURRENT_MILESTONE_NAME: ContactField = {
  id: 'kDJtet5hY2uM4wdMP4g9',
  key: 'contact.ss_current_milestone_name',
};

export const SS_LAST_NO_SHOW_DATE: ContactField = {
  id: 'qcHzGkUzI00vYq064ke8',
  key: 'contact.ss_last_no_show_date',
};

export const SS_LAST_SESSION_DURATION: ContactField = {
  id: 'Os5XUdHhAQ4P5TwyCvLO',
  key: 'contact.ss_last_session_duration',
};

export const SS_LAST_SESSION_TOPIC: ContactField = {
  id: 'OdkNUfLReaXZVNar10NG',
  key: 'contact.ss_last_session_topic',
};

export const SS_NO_SHOW_COUNT: ContactField = {
  id: 'GNBXtuTnYemgOG0DzO7i',
  key: 'contact.ss_no_show_count',
};

export const SS_RESCHEDULED_COUNT: ContactField = {
  id: 'Zdr0OZ5N1kkI0btqBxHf',
  key: 'contact.ss_rescheduled_count',
};

// ============================================
// T&C CONSENT FIELDS (written at enrollment)
// ============================================

export const SS_TC_ACCEPTED: ContactField = {
  id: 'CQd9Am0C5eIJhzz5Rhim',
  key: 'contact.ss_tc_accepted',
};

export const SS_TC_ACCEPTED_DATE: ContactField = {
  id: 'WuQwHBteNEmHjt6Rotvu',
  key: 'contact.ss_tc_accepted_date',
};

export const SS_TC_CLAUSES_ACCEPTED: ContactField = {
  id: 'kxz8fi4BbqWSB9i4pwi5',
  key: 'contact.ss_tc_clauses_accepted',
};

export const SS_TC_IP_ADDRESS: ContactField = {
  id: 'SMwyw2RuCRUuiIVsYQf6',
  key: 'contact.ss_tc_ip_address',
};

export const SS_TC_USER_AGENT: ContactField = {
  id: 'zAa45LPaemE94qnYp42G',
  key: 'contact.ss_tc_user_agent',
};

export const SS_CONSENT_VERSION: ContactField = {
  id: '9Apu29lbP8HR7hg7MQS4',
  key: 'contact.ss_consent_version',
};

export const SS_DIGITAL_SIGNATURE: ContactField = {
  id: 'tmxKrZwfG3DJnDHMdco9',
  key: 'contact.ss_digital_signature',
};

// ============================================
// PAYMENT FIELDS (19 fields — updated on every payment event)
// ============================================

export const SS_PAYMENT_STATUS: ContactField = {
  id: 'p68mR1Khyusaa18EvL4z',
  key: 'contact.ss_payment_status',
  // Options: Current, Past Due, Failed, Cancelled, Completed
};

export const SS_LAST_PAYMENT_DATE: ContactField = {
  id: 'nATlf8t2tePNX3UUU2o5',
  key: 'contact.ss_last_payment_date',
};

export const SS_LAST_PAYMENT_AMOUNT: ContactField = {
  id: 'vzwyRaNBAeNDvT1GHPvo',
  key: 'contact.ss_last_payment_amount',
};

export const SS_PAYMENTS_MADE: ContactField = {
  id: 'D95Aw9yPL2epoVfWz5fd',
  key: 'contact.ss_payments_made',
};

export const SS_PAYMENTS_REMAINING: ContactField = {
  id: 'IHnJQ43z9a8rxgZZaTYH',
  key: 'contact.ss_payments_remaining',
};

export const SS_TOTAL_SCHEDULED: ContactField = {
  id: 'EKIdq5Wosw24GXR69kvU',
  key: 'contact.ss_total_scheduled',
};

export const SS_TOTAL_CONTRACT_VALUE: ContactField = {
  id: 'IQYR3WMeoIi4SkdkEb4l',
  key: 'contact.ss_total_contract_value',
};

export const SS_SUCCESSFUL_PAYMENT_COUNT: ContactField = {
  id: 'gv8N35VHKq8rTFCocHy1',
  key: 'contact.ss_successful_payment_count',
};

export const SS_FAILED_PAYMENT_COUNT: ContactField = {
  id: 'MxygucLglbZK0AftFqOy',
  key: 'contact.ss_failed_payment_count',
};

export const SS_LAST_FAILED_PAYMENT_DATE: ContactField = {
  id: 'gLeQ0N7PRi6klBRSD5vJ',
  key: 'contact.ss_last_failed_payment_date',
};

export const SS_BILLING_FREQUENCY: ContactField = {
  id: 'TQND8rFCdsmTenW8StR4',
  key: 'contact.ss_billing_frequency',
  // Options: One-Time, Weekly, Bi-Weekly, Monthly, Quarterly, Annually
};

export const SS_SUBSCRIPTION_START: ContactField = {
  id: 'ekNPiHgn4oFIZs0oZvIq',
  key: 'contact.ss_subscription_start',
};

export const SS_PAYMENT_GRACE_PERIOD_END: ContactField = {
  id: 'Qb5gPFCYYZ67glv5JxPC',
  key: 'contact.ss_payment_grace_period_end',
};

export const SS_TOTAL_PAID: ContactField = {
  id: 'XHN25syeO46t4yXhECEn',
  key: 'contact.ss_total_paid',
};

export const SS_REMAINING_BALANCE: ContactField = {
  id: 'dKyLgyZRHulnOL9y8WYS',
  key: 'contact.ss_remaining_balance',
};

export const SS_NEXT_PAYMENT_DATE: ContactField = {
  id: 'NbVGvae1gc60e9UO2Pbu',
  key: 'contact.ss_next_payment_date',
};

// ============================================
// REFUND FIELDS
// ============================================

export const SS_REFUND_AMOUNT: ContactField = {
  id: 'eORyRt0Fd8kliP8Fmqem',
  key: 'contact.ss_refund_amount',
};

export const SS_REFUND_DATE: ContactField = {
  id: 'Hv8oYaNU1cobRqqQ2JyT',
  key: 'contact.ss_refund_date',
};

export const SS_REFUND_TRANSACTION_ID: ContactField = {
  id: 'pcTtpZyVshitn1vl6sO0',
  key: 'contact.ss_refund_transaction_id',
};

// ============================================
// DEFENSE / CHARGEBACK FIELDS
// ============================================

export const SS_DEFENSE_PACKET_URL: ContactField = {
  id: 'eE6oTTliF5SjdNUticAJ',
  key: 'contact.ss_defense_packet_url',
};

export const SS_DEFENSE_PDF_URL: ContactField = {
  id: 'x1oQpEueFMZw0FYOIpSQ',
  key: 'contact.ss_defense_pdf_url',
};

export const SS_LAST_DEFENSE_DATE: ContactField = {
  id: 'E9I89U3xVWgon69rb5KP',
  key: 'contact.ss_last_defense_date',
};

export const SS_CHARGEBACK_REASON_CODE: ContactField = {
  id: 'y7iYu81FWG3bGhjrsIHQ',
  key: 'contact.ss_chargeback_reason_code',
};

export const CHARGEBACK_AMOUNT: ContactField = {
  id: '1GKP1CPvpMQc5Mde9TWc',
  key: 'contact.chargeback_amount',
};

export const CHARGEBACK_DATE: ContactField = {
  id: 'm9mK9zzbOljlz1h0N0mC',
  key: 'contact.chargeback_date',
};

export const CHARGEBACK_REASON_CODE: ContactField = {
  id: '5iJc1T4eA6Zz7yU4fmhK',
  key: 'contact.chargeback_reason_code',
};

export const ORIGINAL_TRANSACTION_DATE: ContactField = {
  id: 'gxtTPP6fRs1GeDbctb7B',
  key: 'contact.original_transaction_date',
};

export const GENERATE_EVIDENCE_PDF: ContactField = {
  id: 'pYMD57WfMr36nQsVImhK',
  key: 'contact.generate_evidence_pdf',
};

// ============================================
// SIGN-OFF FIELDS
// ============================================

export const SS_SIGNOFF_MILESTONE_NUMBER: ContactField = {
  id: 'GOu3rqPbiSpLNs6cLUNj',
  key: 'contact.ss_signoff_milestone_number',
};

export const SS_SIGNOFF_MILESTONE_NAME: ContactField = {
  id: 'lc42DcbNHSX3nxAXaVb1',
  key: 'contact.ss_signoff_milestone_name',
};

export const SS_SIGNOFF_WORK_SUMMARY: ContactField = {
  id: 'YdV8qyYtRrCE7j5Bm32X',
  key: 'contact.ss_signoff_work_summary',
};

// ============================================
// OFFER FIELDS (copied from offer to contact at enrollment)
// ============================================

export const OFFER_ID: ContactField = {
  id: 'HdYATCMp3XHcEOjRUubE',
  key: 'contact.offer_id',
};

export const OFFER_PROGRAM_NAME: ContactField = {
  id: 'WxhdMFyC5KIltJQgGywE',
  key: 'contact.offer_program_name',
};

export const OFFER_PROGRAM_DESCRIPTION: ContactField = {
  id: 'WMOcW5n1yMdCA1yNy2pW',
  key: 'contact.offer_program_description',
};

export const OFFER_PAYMENT_TYPE: ContactField = {
  id: 'U3z8mRWYzv7hfuiTE2cL',
  key: 'contact.offer_payment_type',
};

export const OFFER_PAYMENT_AMOUNT: ContactField = {
  id: 'i1l7QMfafhINP8SIGNIX',
  key: 'contact.offer_payment_amount',
};

export const OFFER_INSTALLMENT_AMOUNT: ContactField = {
  id: 'TlCByNHhcQdz7ut5qBfj',
  key: 'contact.offer_installment_amount',
};

export const OFFER_INSTALLMENT_FREQUENCY: ContactField = {
  id: 'L4MluH0bSsVbYx3m2aud',
  key: 'contact.offer_installment_frequency',
};

export const OFFER_NUMBER_OF_PAYMENTS: ContactField = {
  id: 'PswWffs3VXhcmu8H1Ctm',
  key: 'contact.offer_number_of_payments',
};

export const OFFER_PRICE_DISPLAY: ContactField = {
  id: 'b9O4GdgzOG31N3HQeI3l',
  key: 'contact.offer_price_display',
};

export const OFFER_PIF_PRICE: ContactField = {
  id: 'XVSTbF4VaWpD1X6KxuJv',
  key: 'contact.offer_pif_price',
};

export const OFFER_PAYMENT_STRUCTURE: ContactField = {
  id: 'Rz3vk79NrKyX9FD96Lek',
  key: 'contact.offer_payment_structure',
};

export const OFFER_BUSINESS_NAME: ContactField = {
  id: 'vZsVWpxIryJini2bYSKH',
  key: 'contact.offer_business_name',
};

export const OFFER_SUPPORT_EMAIL: ContactField = {
  id: 'YH3flESKvs7IrdFoDOqT',
  key: 'contact.offer_support_email',
};

export const OFFER_TC_DOCUMENT_URL: ContactField = {
  id: 'nUkBJ3MAfDL0CYiNxoCe',
  key: 'contact.offer_tc_document_url',
};

export const OFFER_REFUND_POLICY: ContactField = {
  id: 'PCvhzEZFNEGFdILRCe7f',
  key: 'contact.offer_refund_policy',
};

export const OFFER_COMPILED_TC_HTML: ContactField = {
  id: 'BarcTr9vVsDQfx8mU4nl',
  key: 'contact.offer_compiled_tc_html',
};

// ============================================
// OFFER MILESTONE FIELDS ON CONTACT (M1-M8 × 3 = 24 fields)
// ============================================

export const OFFER_MILESTONE_FIELDS = [
  {
    name: { id: 'FaGi4ocak7OxVuSporOy', key: 'contact.offer_m1_name' },
    delivers: { id: 'BXcB7e8Ad8Nyr3oLZaNE', key: 'contact.offer_m1_delivers' },
    clientDoes: { id: '2f677eMmTrIoZDzOoXGv', key: 'contact.offer_m1_client_does' },
  },
  {
    name: { id: 'bYa4rxUXxR5dIgO3xg2A', key: 'contact.offer_m2_name' },
    delivers: { id: 'VUICjslnyC2MnWwz0rpy', key: 'contact.offer_m2_delivers' },
    clientDoes: { id: 'Uiip8M5Ruo40tYqvVRXA', key: 'contact.offer_m2_client_does' },
  },
  {
    name: { id: 'qbpR2qxxi6gyodgjm96p', key: 'contact.offer_m3_name' },
    delivers: { id: 'PPHYx4wNhyc8XE5e1zws', key: 'contact.offer_m3_delivers' },
    clientDoes: { id: 'TB4kXg6uaYOKIWpwhhWb', key: 'contact.offer_m3_client_does' },
  },
  {
    name: { id: 'Tz0DMmiX0vD7WnNXuBiq', key: 'contact.offer_m4_name' },
    delivers: { id: 'CKtanhTXarCJJtCBS7ss', key: 'contact.offer_m4_delivers' },
    clientDoes: { id: '7ldOLyiAHJZbzsslbksh', key: 'contact.offer_m4_client_does' },
  },
  {
    name: { id: 'bEUVwoa1iAXvUvcliu5J', key: 'contact.offer_m5_name' },
    delivers: { id: 'L4iEB3piOeXlW3tYeuLA', key: 'contact.offer_m5_delivers' },
    clientDoes: { id: 'pyraXsqnTiVcPw3IxwsF', key: 'contact.offer_m5_client_does' },
  },
  {
    name: { id: 'OPiM7JgqQ0n4nfmNhsBu', key: 'contact.offer_m6_name' },
    delivers: { id: 'P8VsDvuZjGs5EH8JhRt7', key: 'contact.offer_m6_delivers' },
    clientDoes: { id: 'ihpKZJeTyhXskoHBKlmk', key: 'contact.offer_m6_client_does' },
  },
  {
    name: { id: 'NGg0mCFRhu4jVeJJ3uZO', key: 'contact.offer_m7_name' },
    delivers: { id: 'hnhaECn6gycfJlFxv90C', key: 'contact.offer_m7_delivers' },
    clientDoes: { id: '8NO75q1MgjGLinDqbd7r', key: 'contact.offer_m7_client_does' },
  },
  {
    name: { id: 'OkpXtBWIpAbSytrrWU0w', key: 'contact.offer_m8_name' },
    delivers: { id: 'JlAWAG9dZTZIIDpkbHvG', key: 'contact.offer_m8_delivers' },
    clientDoes: { id: 'ts5JpZRWEvX1kvLEugHz', key: 'contact.offer_m8_client_does' },
  },
] as const;

// ============================================
// OFFER CLAUSE FIELDS ON CONTACT (11 slots × 2 = 22 fields)
// ============================================

export const OFFER_CLAUSE_FIELDS = [
  { title: { id: 'tZ92lyTrtn79EKVThoYL', key: 'contact.offer_clause_slot_1_title' }, text: { id: 'bNTK5eDGzjJC2tvaODOT', key: 'contact.offer_clause_slot_1_text' } },
  { title: { id: 'L8kQXcSpz0wBqJHUIGl2', key: 'contact.offer_clause_slot_2_title' }, text: { id: 'PIXNNZkHgdBtFBrq2Zbq', key: 'contact.offer_clause_slot_2_text' } },
  { title: { id: 'b0N8mtoB0xIiZggyyQhD', key: 'contact.offer_clause_slot_3_title' }, text: { id: '4586pi0QVkbJaQzY9PAf', key: 'contact.offer_clause_slot_3_text' } },
  { title: { id: 'AFQ3rVNeKbUYdXjgnAe4', key: 'contact.offer_clause_slot_4_title' }, text: { id: 'YUyLhuKMRLpJpyp6EcFs', key: 'contact.offer_clause_slot_4_text' } },
  { title: { id: 'TDwJhqLTLZoZRRgd7kVr', key: 'contact.offer_clause_slot_5_title' }, text: { id: '7KQyOu7lmMJu2oCHx7AW', key: 'contact.offer_clause_slot_5_text' } },
  { title: { id: '1stHUuuwcvmDDXa79OnH', key: 'contact.offer_clause_slot_6_title' }, text: { id: 'VoDAT5DD6l1izGy3q3k7', key: 'contact.offer_clause_slot_6_text' } },
  { title: { id: 'EUyE0bnked2Kwnwgwcft', key: 'contact.offer_clause_slot_7_title' }, text: { id: '1bpeLjIJGEvmSx7g0fz6', key: 'contact.offer_clause_slot_7_text' } },
  { title: { id: 'tS6KeOfavPa27Z5cfJ6F', key: 'contact.offer_clause_slot_8_title' }, text: { id: 'cdCrwf86ILbJc3Bb6LFi', key: 'contact.offer_clause_slot_8_text' } },
  { title: { id: 'lrzeewAtNvlbHsLQOCHQ', key: 'contact.offer_clause_slot_9_title' }, text: { id: 'GdMcEdpxQvSzxv96mvWY', key: 'contact.offer_clause_slot_9_text' } },
  { title: { id: 'p6IWcMP9NRAoGErAINY9', key: 'contact.offer_clause_slot_10_title' }, text: { id: 'hC6BuSIWGW2h68nvpUby', key: 'contact.offer_clause_slot_10_text' } },
  { title: { id: 'GddQzp5fKG2s3IWXHM1m', key: 'contact.offer_clause_slot_11_title' }, text: { id: 'iV2vA7NMpzPY7F4gKqKo', key: 'contact.offer_clause_slot_11_text' } },
] as const;

// ============================================
// T&C CLAUSE TOGGLE FIELDS (9 standard clauses)
// These Yes/No fields determine which clauses appear in the clickwrap
// ============================================

export const TC_CLAUSE_TOGGLES = {
  PURCHASE_SUMMARY: { id: 'SfFXxeFN8A3vagFhNUgY', key: 'contact.include_purchase_summary_clause' },
  CARDHOLDER_AUTH: { id: 'Lk39AD57aNvuAYRxniaV', key: 'contact.include_cardholder_authorization_clause' },
  PROGRAM_SCOPE: { id: 'zTT4HkFwTfC8dudfaMLv', key: 'contact.include_program_scope_clause' },
  NO_GUARANTEED_RESULTS: { id: '6ID6evkCnsEYLQEmTKvU', key: 'contact.include_no_guaranteed_results_clause' },
  DIGITAL_ACCESS: { id: 'DTlLX4N2snToK3eJ7vGt', key: 'contact.include_digital_access_clause' },
  PARTICIPATION_RESPONSIBILITY: { id: 'WvJbxg9gK3tp5CSVZloG', key: 'contact.include_participation_responsibility_clause' },
  FEEDBACK_CHECKIN: { id: 'wCvVPDUYHmNqJoBKYM9c', key: 'contact.include_feedback__checkin_clause' },
  REFUND_CANCELLATION: { id: '4qpYeh8afmwUt6VLD8Wk', key: 'contact.include_refund__cancellation_clause' },
  INSTALLMENT_BILLING: { id: 'fZz74nxrj2Un7d8I62FS', key: 'contact.include_installment_billing_clause' },
} as const;

// ============================================
// ONBOARDING FIELDS (merchant setup via contact record)
// ============================================

export const ONBOARDING_BUSINESS_NAME: ContactField = {
  id: 'isaGDUKqPT0Z88agwbeh',
  key: 'contact.onboarding_business_name',
};

export const ONBOARDING_SUPPORT_EMAIL: ContactField = {
  id: 'ZShhuP4onQK7VLpzwuVQ',
  key: 'contact.onboarding_support_email',
};

export const ONBOARDING_PAYMENT_DESCRIPTOR: ContactField = {
  id: '6HcCVhDRZPO50i2PNfwF',
  key: 'contact.onboarding_payment_descriptor',
};

/** Onboarding milestone fields (1-8 name + description). */
export const ONBOARDING_MILESTONE_FIELDS = [
  { name: { id: '3rn6zaWpjaXCYGVjFeII', key: 'contact.onboarding_milestone_1_name' }, desc: { id: 'PIfg5G8vaqsAVHwO1PBn', key: 'contact.onboarding_milestone_1_description' } },
  { name: { id: '0kbpO0U7BLN3Ac38Q4mV', key: 'contact.onboarding_milestone_2_name' }, desc: { id: 'eJjYbAGEH7Ixd9R8QCHg', key: 'contact.onboarding_milestone_2_description' } },
  { name: { id: 'vgut0KfgFFYd9oLQ1xDg', key: 'contact.onboarding_milestone_3_name' }, desc: { id: 'bOAoy3oD7Nr9pENhuP9T', key: 'contact.onboarding_milestone_3_description' } },
  { name: { id: 'McKEROEGn4evex7Fkgm4', key: 'contact.onboarding_milestone_4_name' }, desc: { id: 'eUWIkJ0GYXdKrxz0bKBd', key: 'contact.onboarding_milestone_4_description' } },
  { name: { id: 'dlYAZrKPhu0UFqiYf9Kk', key: 'contact.onboarding_milestone_5_name' }, desc: { id: '249a66uuPCmqPKh08Ukh', key: 'contact.onboarding_milestone_5_description' } },
  { name: { id: 'n8HUxlIe4uaueXYH4xkR', key: 'contact.onboarding_milestone_6_name' }, desc: { id: 'SLeMatlrn5kJvlFqZfId', key: 'contact.onboarding_milestone_6_description' } },
  { name: { id: 'hZAfF4P3w2gmQPz7grDt', key: 'contact.onboarding_milestone_7_name' }, desc: { id: 'K5Gyn0bbrFDBX0gg2j9X', key: 'contact.onboarding_milestone_7_description' } },
  { name: { id: 'nMQnRyX98HSLNsqdfLXq', key: 'contact.onboarding_milestone_8_name' }, desc: { id: 'jXnaTAbFLZ9GGfLxgNuZ', key: 'contact.onboarding_milestone_8_description' } },
] as const;

/** Onboarding module toggle fields. */
export const ONBOARDING_MODULE_TOGGLES = {
  SESSION_TRACKING: { id: 'Ll5Iy97FYwJDNjXmjyns', key: 'contact.onboarding_module_session_tracking' },
  MILESTONE_TRACKING: { id: 'RyxYXFDCNaIQTbyuCaD2', key: 'contact.onboarding_module_milestone_tracking' },
  PULSE_CHECK: { id: 'S8NyQk7YTReoaJlDpdz2', key: 'contact.onboarding_module_pulse_check' },
  PAYMENT_TRACKING: { id: 'Qdxjrp4lmDOC7rr9tBek', key: 'contact.onboarding_module_payment_tracking' },
  COURSE_PROGRESS: { id: 'Icn9wvJo1BWVYQXsCUo5', key: 'contact.onboarding_module_course_progress' },
} as const;

// ============================================
// MISC FIELDS
// ============================================

export const PRICE_CENTS: ContactField = {
  id: 't4Ztmur3LjIzF7yB00XW',
  key: 'contact.price_cents',
};

export const REFUND_WINDOW_DAYS: ContactField = {
  id: '4RayisaYlCuHnnSfYRqF',
  key: 'contact.refund_window_days',
};

export const DELIVERABLES: ContactField = {
  id: 'cgi700S7ktc0PvkEGbx3',
  key: 'contact.deliverables',
};
