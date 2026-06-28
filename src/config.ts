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

const nodeEnv = optional('NODE_ENV', 'development');
const isProd = nodeEnv === 'production';

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
    clientId: required('GHL_APP_CLIENT_ID'),
    clientSecret: required('GHL_APP_CLIENT_SECRET'),
    ssoKey: required('GHL_APP_SSO_KEY'),
    apiDomain: optional('GHL_API_DOMAIN', 'https://services.leadconnectorhq.com'),
  },

  // Supabase
  supabase: {
    url: required('SUPABASE_URL'),
    serviceKey: required('SUPABASE_SERVICE_KEY'),
  },

  // Stripe Connect (platform keys)
  stripe: {
    secretKey: process.env.STRIPE_SECRET_KEY || '',
    publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || '',
    clientId: process.env.STRIPE_CLIENT_ID || '',
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '',
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

  // Public action links (payment update, cancellation, milestone signoff)
  publicActionTokenSecret: optional('PUBLIC_ACTION_TOKEN_SECRET', ''),

  // Server
  port: parseInt(optional('PORT', '3000'), 10),
  nodeEnv,
  logLevel: optional('LOG_LEVEL', 'debug'),

  isDev: nodeEnv === 'development',
  isProd,
};
