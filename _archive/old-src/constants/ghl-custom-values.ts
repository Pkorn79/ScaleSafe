/**
 * ghl-custom-values.ts — GHL Location-Level Custom Values
 *
 * These are per-merchant configuration settings stored in GHL at the location level.
 * When a merchant installs ScaleSafe, their accept.blue credentials, business info,
 * evidence module toggles, and incentive config are stored here.
 *
 * Each constant has:
 * - id: The GHL custom value ID (used for API calls)
 * - key: The field key path (used for reading/writing values)
 *
 * Source: docs/ghl-custom-values-reference.md (pulled from live GHL account)
 */

interface CustomValue {
  id: string;
  key: string;
}

// ============================================
// PAYMENT PROCESSING (accept.blue credentials)
// ============================================

export const CV_AB_API_KEY: CustomValue = {
  id: 'lxPxOglGHMieOiK5bUwM',
  key: 'custom_values.ss_acceptblue_api_key',
};

export const CV_AB_TOKENIZATION_KEY: CustomValue = {
  id: 'xtPiKYYbcfNowiOipbCH',
  key: 'custom_values.ss_acceptblue_tokenization_key',
};

export const CV_AB_WEBHOOK_SIGNATURE: CustomValue = {
  id: 'MswKqTl2UPSneAxp9IMN',
  key: 'custom_values.ss_acceptblue_webhook_signature',
};

// ============================================
// EVIDENCE MODULE TOGGLES
// ============================================

export const CV_MODULE_SESSION_TRACKING: CustomValue = {
  id: 'Q64Vqn0999BaIJSnlFH5',
  key: 'custom_values.module_session_tracking',
};

export const CV_MODULE_MILESTONE_TRACKING: CustomValue = {
  id: 'BPFyTTfzpYid2czXA9yc',
  key: 'custom_values.module_milestone_tracking',
};

export const CV_MODULE_PULSE_CHECK: CustomValue = {
  id: 'zizjMRy90Wmne1HgBbbO',
  key: 'custom_values.module_pulse_check',
};

export const CV_MODULE_PAYMENT_TRACKING: CustomValue = {
  id: 'tOpaMP3jA10snLbRaxYK',
  key: 'custom_values.module_payment_tracking',
};

export const CV_MODULE_COURSE_PROGRESS: CustomValue = {
  id: 'AU6yS8nrtosMMv604KKe',
  key: 'custom_values.module_course_progress',
};

// ============================================
// BUSINESS INFO
// ============================================

export const CV_BUSINESS_LEGAL_NAME: CustomValue = {
  id: 'iESTshvt8V7IqZXUBBzi',
  key: 'custom_values.merchant_business_name',
};

export const CV_SUPPORT_EMAIL: CustomValue = {
  id: 'gEsZy8Ret45U0unNjDuD',
  key: 'custom_values.merchant_support_email',
};

export const CV_DESCRIPTOR: CustomValue = {
  id: 'WCRDwTk8SnmFz9f0rv8i',
  key: 'custom_values.merchant_descriptor',
};

export const CV_DBA_BRAND_NAME: CustomValue = {
  id: 'LiM2XsXvDxCobBd2L4RR',
  key: 'custom_values.dba__brand_name',
};

export const CV_INDUSTRY: CustomValue = {
  id: '662Fd1Xk4D4qbTsEvcsZ',
  key: 'custom_values.industry__niche',
};

export const CV_BUSINESS_WEBSITE: CustomValue = {
  id: '0THx2VjueA5hbPHUqCGR',
  key: 'custom_values.business_website',
};

export const CV_BUSINESS_CITY: CustomValue = {
  id: 'FffLp4MEJcx3t8UMMfp5',
  key: 'custom_values.business_city',
};

export const CV_BUSINESS_STATE: CustomValue = {
  id: 'VPLzXhhiFdJt4kwUnSl2',
  key: 'custom_values.business_state',
};

export const CV_SHORT_BUSINESS_DESC: CustomValue = {
  id: 'FmfF4jOIlJfWx6F4akS5',
  key: 'custom_values.short_business_description',
};

export const CV_PRIMARY_SERVICE_TYPE: CustomValue = {
  id: 'jn7TqOAKzaQlbykK7Cx2',
  key: 'custom_values.primary_service_type',
};

export const CV_PLATFORMS_USED: CustomValue = {
  id: '7fpW9rG1jksv5IeUMT4x',
  key: 'custom_values.platforms_used',
};

// ============================================
// T&C CONFIGURATION
// ============================================

export const CV_COMPILED_TERMS_HTML: CustomValue = {
  id: 'dVgKAZoN3kRgt9LReK5D',
  key: 'custom_values.compiled_terms_html',
};

export const CV_CUSTOM_CLAUSE_1_TITLE: CustomValue = {
  id: '8UjvOaqDGuAHiuFKoxZL',
  key: 'custom_values.custom_clause_1_title',
};

export const CV_CUSTOM_CLAUSE_1_TEXT: CustomValue = {
  id: 'Yc0yCNh7a2435TakCK07',
  key: 'custom_values.custom_clause_1_text',
};

export const CV_CUSTOM_CLAUSE_2_TITLE: CustomValue = {
  id: 'Rjr1hRPb3EpzOXsTrp2r',
  key: 'custom_values.custom_clause_2_title',
};

export const CV_CUSTOM_CLAUSE_2_TEXT: CustomValue = {
  id: 'gbedeBTz3r4ToDk3AyFu',
  key: 'custom_values.custom_clause_2_text',
};

export const CV_TC_DOCUMENT_URL: CustomValue = {
  id: 'DRn473kax3uBo0oPgJ0y',
  key: 'custom_values.tc_document_url',
};

export const CV_TC_HAS_OWN: CustomValue = {
  id: 'DofNxxWQB1IljnnajmCw',
  key: 'custom_values.tc_has_own',
};

// ============================================
// INCENTIVE PROGRAM
// ============================================

export const CV_INCENTIVE_ENABLED: CustomValue = {
  id: 'oP9sVp7sEqe1EbyR9luk',
  key: 'custom_values.incentive_program_enabled',
};

export const CV_INCENTIVE_TIER1_DESC: CustomValue = {
  id: 'fua93uEhRVs69p6EWUL5',
  key: 'custom_values.incentive_tier_1_description',
};

export const CV_INCENTIVE_TIER1_THRESHOLD: CustomValue = {
  id: '21Hf3ufWkY4rKia7CL6m',
  key: 'custom_values.incentive_tier_1_threshold',
};

export const CV_INCENTIVE_TIER2_DESC: CustomValue = {
  id: 'tmCbp3CLB2boIcCODrEd',
  key: 'custom_values.incentive_tier_2_description',
};

export const CV_INCENTIVE_TIER2_THRESHOLD: CustomValue = {
  id: '9kwAdDYxv2DBr0NP1dEM',
  key: 'custom_values.incentive_tier_2_threshold',
};

// ============================================
// LEGACY / SYSTEM
// ============================================

export const CV_EVIDENCE_SHEET_ID: CustomValue = {
  id: 'LeIj7BfOmOxG93IUi3BW',
  key: 'custom_values.evidence_sheet_id',
};

export const CV_MERCHANT_LOGO_URL: CustomValue = {
  id: '0iJyQ60vyZjVA8ILNi5Y',
  key: 'custom_values.ss_merchant_logo_url',
};

// ============================================
// MILESTONES (location-level names/descriptions)
// ============================================

export const CV_MILESTONE_NAMES = [
  { id: 'y7Nb4FpFDGa1B6SSLg1P', key: 'custom_values.milestone_1_name' },
  { id: 'vB8jK3nL0Mq2Yr9Ks5Pt', key: 'custom_values.milestone_2_name' },
  { id: 'tU9lP4xQ1Rn3Zs0At6Bv', key: 'custom_values.milestone_3_name' },
  { id: 'sC5mD6eF7Gh8Ij9Kl0No', key: 'custom_values.milestone_4_name' },
  { id: 'rP1qJ2wX3Cy4Dz5Ea6Fb', key: 'custom_values.milestone_5_name' },
  { id: 'qO7sM8nL9Uk0Pj1Iq2Hr', key: 'custom_values.milestone_6_name' },
  { id: 'pN6tL5kM4Hj3Gi2Rf1Ug', key: 'custom_values.milestone_7_name' },
  { id: '1H0yV8jVIpP3OU4nJY9a', key: 'custom_values.milestone_8_name' },
] as const;

export const CV_MILESTONE_DESCS = [
  { id: 'a2aN4ggttqak8LR7dKT2', key: 'custom_values.milestone_1_description' },
  { id: 'b3bB5hhuurbl9MS8eLU3', key: 'custom_values.milestone_2_description' },
  { id: 'c4cC6iiuvscm0NT9fMV4', key: 'custom_values.milestone_3_description' },
  { id: 'd5dD7jjvwtdn1OU0gNW5', key: 'custom_values.milestone_4_description' },
  { id: 'e6eE8kkwxueo2PV1hOX6', key: 'custom_values.milestone_5_description' },
  { id: 'f7fF9llxyufp3QW2iPY7', key: 'custom_values.milestone_6_description' },
  { id: 'g8gG0mmyzuvq4RX3jQZ8', key: 'custom_values.milestone_7_description' },
  { id: 'DvRAlFrYVQpfE8TWjkPv', key: 'custom_values.milestone_8_description' },
] as const;

/**
 * All custom values grouped for bulk fetch during merchant provisioning.
 * Used by merchant.service.provision() to read all config in one pass.
 */
export const ALL_CUSTOM_VALUES = [
  CV_AB_API_KEY, CV_AB_TOKENIZATION_KEY, CV_AB_WEBHOOK_SIGNATURE,
  CV_MODULE_SESSION_TRACKING, CV_MODULE_MILESTONE_TRACKING, CV_MODULE_PULSE_CHECK,
  CV_MODULE_PAYMENT_TRACKING, CV_MODULE_COURSE_PROGRESS,
  CV_BUSINESS_LEGAL_NAME, CV_SUPPORT_EMAIL, CV_DESCRIPTOR, CV_DBA_BRAND_NAME,
  CV_INDUSTRY, CV_BUSINESS_WEBSITE, CV_BUSINESS_CITY, CV_BUSINESS_STATE,
  CV_SHORT_BUSINESS_DESC, CV_PRIMARY_SERVICE_TYPE, CV_PLATFORMS_USED,
  CV_COMPILED_TERMS_HTML, CV_TC_DOCUMENT_URL, CV_TC_HAS_OWN,
  CV_INCENTIVE_ENABLED, CV_INCENTIVE_TIER1_DESC, CV_INCENTIVE_TIER1_THRESHOLD,
  CV_INCENTIVE_TIER2_DESC, CV_INCENTIVE_TIER2_THRESHOLD,
  CV_MERCHANT_LOGO_URL,
] as const;
