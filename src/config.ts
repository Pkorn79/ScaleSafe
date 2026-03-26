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

  // Claude API (optional — only needed for defense compilation)
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',

  // Server
  port: parseInt(optional('PORT', '3000'), 10),
  nodeEnv: optional('NODE_ENV', 'development'),
  logLevel: optional('LOG_LEVEL', 'debug'),

  isDev: optional('NODE_ENV', 'development') === 'development',
  isProd: optional('NODE_ENV', 'development') === 'production',
};
