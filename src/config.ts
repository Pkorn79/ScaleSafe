import dotenv from 'dotenv';
dotenv.config();

function required(key: string): string {
  const val = process.env[key];
  if (!val) {
    console.error(`FATAL: Missing required environment variable: ${key}`);
    process.exit(1);
  }
  return val;
}

function optional(key: string, fallback: string): string {
  return process.env[key] || fallback;
}

function optionalPositiveInteger(key: string, fallback: number, minimum = 1): number {
  const parsed = Number.parseInt(process.env[key] || '', 10);
  return Number.isFinite(parsed) && parsed >= minimum ? parsed : fallback;
}

function optionalBoolean(key: string): boolean | null {
  const value = String(process.env[key] || '').trim().toLowerCase();
  if (!value) return null;
  if (value === 'true') return true;
  if (value === 'false') return false;
  console.error(`FATAL: ${key} must be true or false`);
  process.exit(1);
}

const nodeEnv = optional('NODE_ENV', 'development');
const isProd = nodeEnv === 'production';
const ghlClientId = required('GHL_APP_CLIENT_ID');
const stripeSecretKey = process.env.STRIPE_SECRET_KEY || '';
const stripePublishableKey = process.env.STRIPE_PUBLISHABLE_KEY || '';
const stripeClientId = process.env.STRIPE_CLIENT_ID || '';
const stripeWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET || '';
const stripeVariables = {
  STRIPE_SECRET_KEY: stripeSecretKey,
  STRIPE_PUBLISHABLE_KEY: stripePublishableKey,
  STRIPE_CLIENT_ID: stripeClientId,
  STRIPE_WEBHOOK_SECRET: stripeWebhookSecret,
};
const stripeConfigured = Object.values(stripeVariables).some(Boolean);
const stripeLiveMode = optionalBoolean('STRIPE_LIVE_MODE');

if (isProd && stripeConfigured) {
  const missing = Object.entries(stripeVariables)
    .filter(([, value]) => !value)
    .map(([key]) => key);
  if (missing.length > 0) {
    console.error(`FATAL: Incomplete Stripe platform configuration. Missing: ${missing.join(', ')}`);
    process.exit(1);
  }
  if (stripeLiveMode === null) {
    console.error('FATAL: STRIPE_LIVE_MODE must be explicitly set when Stripe is configured in production');
    process.exit(1);
  }
}

if (stripeLiveMode !== null) {
  const expectedSecretPrefix = stripeLiveMode ? 'sk_live_' : 'sk_test_';
  const expectedPublishablePrefix = stripeLiveMode ? 'pk_live_' : 'pk_test_';
  if (stripeSecretKey && !stripeSecretKey.startsWith(expectedSecretPrefix)) {
    console.error(`FATAL: STRIPE_SECRET_KEY does not match STRIPE_LIVE_MODE=${stripeLiveMode}`);
    process.exit(1);
  }
  if (stripePublishableKey && !stripePublishableKey.startsWith(expectedPublishablePrefix)) {
    console.error(`FATAL: STRIPE_PUBLISHABLE_KEY does not match STRIPE_LIVE_MODE=${stripeLiveMode}`);
    process.exit(1);
  }
}

function deriveGhlAppId(clientId: string): string {
  const explicit = process.env.GHL_APP_ID || process.env.GHL_MARKETPLACE_APP_ID || '';
  if (explicit) return explicit;

  const prefix = clientId.split('-')[0];
  return /^[a-f0-9]{24}$/i.test(prefix) ? prefix : '';
}

function failIfProductionFlagEnabled(key: string): void {
  if (isProd && process.env[key] === 'true') {
    console.error(`FATAL: ${key}=true is not allowed in production`);
    process.exit(1);
  }
}

failIfProductionFlagEnabled('ALLOW_DEV_LOCATION_AUTH');
failIfProductionFlagEnabled('ALLOW_UNSIGNED_GHL_WEBHOOKS');
failIfProductionFlagEnabled('ALLOW_UNSIGNED_STRIPE_STATE');
failIfProductionFlagEnabled('ALLOW_LEGACY_PUBLIC_ACTION_LINKS');

if (isProd && !process.env.PUBLIC_ACTION_TOKEN_SECRET) {
  console.error('FATAL: Missing required environment variable: PUBLIC_ACTION_TOKEN_SECRET');
  process.exit(1);
}

export const config = {
  // GHL Marketplace App
  ghl: {
    clientId: ghlClientId,
    clientSecret: required('GHL_APP_CLIENT_SECRET'),
    ssoKey: required('GHL_APP_SSO_KEY'),
    appId: deriveGhlAppId(ghlClientId),
    apiDomain: optional('GHL_API_DOMAIN', 'https://services.leadconnectorhq.com'),
  },

  // Supabase
  supabase: {
    url: required('SUPABASE_URL'),
    serviceKey: required('SUPABASE_SERVICE_KEY'),
    requestTimeoutMs: optionalPositiveInteger('SUPABASE_REQUEST_TIMEOUT_MS', 10_000, 1000),
  },

  // Stripe Connect (platform keys)
  stripe: {
    secretKey: stripeSecretKey,
    publishableKey: stripePublishableKey,
    clientId: stripeClientId,
    webhookSecret: stripeWebhookSecret,
    liveMode: stripeLiveMode,
  },

  // Zoom General App credentials. These belong to ScaleSafe's Zoom app;
  // each merchant's OAuth tokens are encrypted in the database.
  zoom: {
    clientId: process.env.ZOOM_CLIENT_ID || '',
    clientSecret: process.env.ZOOM_CLIENT_SECRET || '',
    webhookSecretToken: process.env.ZOOM_WEBHOOK_SECRET_TOKEN || '',
    redirectUri: process.env.ZOOM_REDIRECT_URI || `${optional('APP_URL', 'http://localhost:3000').replace(/\/$/, '')}/auth/zoom/callback`,
  },

  // Processor encryption (AES-256-GCM for NMI keys)
  processorEncryptionKey: process.env.PROCESSOR_ENCRYPTION_KEY || '',

  // Claude API (optional — only needed for defense compilation)
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',

  // App URL (for OAuth callbacks, webhook URLs)
  appUrl: optional('APP_URL', 'http://localhost:3000'),

  // Cloudflare Turnstile bot protection for public checkout endpoints.
  turnstile: {
    siteKey: process.env.TURNSTILE_SITE_KEY || '',
    secretKey: process.env.TURNSTILE_SECRET_KEY || '',
    enabledDefault: process.env.TURNSTILE_ENABLED_DEFAULT === 'true',
  },

  // Internal ScaleSafe HQ console. If unset, HQ routes return 404.
  hqAdminToken: process.env.SCALESAFE_HQ_ADMIN_TOKEN || '',

  // Global emergency switch. Per-provider and per-location rollout is stored
  // in the database rather than Railway environment variables.
  evidenceConnectorAutomation: {
    enabled: process.env.EVIDENCE_CONNECTOR_AUTOMATION_ENABLED === 'true',
  },

  // Public action links (payment update, cancellation, milestone signoff)
  publicActionTokenSecret: optional('PUBLIC_ACTION_TOKEN_SECRET', ''),

  // Server
  port: parseInt(optional('PORT', '3000'), 10),
  nodeEnv,
  logLevel: optional('LOG_LEVEL', 'debug'),

  isDev: nodeEnv === 'development',
  isProd,
};
