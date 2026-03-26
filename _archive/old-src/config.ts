/**
 * config.ts — Environment Configuration
 *
 * Loads and validates all environment variables at startup.
 * If any required variable is missing, the app fails fast with a clear error message.
 * This prevents runtime surprises from missing config.
 *
 * Usage: import { config } from './config' anywhere in the app.
 */

import dotenv from 'dotenv';
dotenv.config();

/** Reads an env var and throws if it's missing (unless a default is provided). */
function requireEnv(name: string, defaultValue?: string): string {
  const value = process.env[name] || defaultValue;
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

/** Reads an optional env var, returns undefined if not set. */
function optionalEnv(name: string): string | undefined {
  return process.env[name] || undefined;
}

export const config = {
  // GHL Marketplace App
  ghl: {
    clientId: requireEnv('GHL_APP_CLIENT_ID'),
    clientSecret: requireEnv('GHL_APP_CLIENT_SECRET'),
    ssoKey: requireEnv('GHL_APP_SSO_KEY'),
    apiDomain: requireEnv('GHL_API_DOMAIN', 'https://services.leadconnectorhq.com'),
  },

  // Supabase
  supabase: {
    url: requireEnv('SUPABASE_URL'),
    serviceKey: requireEnv('SUPABASE_SERVICE_KEY'),
  },

  // Claude API (optional at startup — only needed for defense compilation)
  anthropic: {
    apiKey: optionalEnv('ANTHROPIC_API_KEY'),
  },

  // Server
  port: parseInt(requireEnv('PORT', '3000'), 10),
  nodeEnv: requireEnv('NODE_ENV', 'development'),
  logLevel: requireEnv('LOG_LEVEL', 'debug'),

  /** Returns true if running in production. */
  isProduction(): boolean {
    return this.nodeEnv === 'production';
  },
};
