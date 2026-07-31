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

function explicitPositiveInteger(key: string): number | null {
  const raw = process.env[key] || '';
  if (!/^\d+$/.test(raw)) return null;
  const parsed = Number.parseInt(raw, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function decodeAes256Key(value: string): Buffer | null {
  if (/^[0-9a-fA-F]{64}$/.test(value)) return Buffer.from(value, 'hex');
  try {
    const decoded = Buffer.from(value, 'base64');
    return decoded.length === 32 ? decoded : null;
  } catch {
    return null;
  }
}

const nodeEnv = optional('NODE_ENV', 'development');
const isProd = nodeEnv === 'production';
const ghlClientId = required('GHL_APP_CLIENT_ID');
const operatorCommandCenterEnabled = process.env.OPERATOR_COMMAND_CENTER_ENABLED === 'true';
const operatorAuthEnabled = process.env.OPERATOR_AUTH_ENABLED === 'true';
const operatorHealthIncidentsEnabled = process.env.OPERATOR_HEALTH_INCIDENTS_ENABLED === 'true';
const operatorHost = optional('OPERATOR_HOST', 'ops.scalesafe.app').toLowerCase();
const operatorTrustProxyHops = explicitPositiveInteger('OPERATOR_TRUST_PROXY_HOPS');
const operatorTokenEncryptionKey = process.env.OPERATOR_AUTH_TOKEN_ENCRYPTION_KEY || '';
const guardianIngestionEnabled = process.env.GUARDIAN_INGESTION_ENABLED === 'true';
const guardianHost = optional('GUARDIAN_HOST', 'guardian.scalesafe.app').toLowerCase();
const guardianMaxBodyBytes = explicitPositiveInteger('GUARDIAN_MAX_BODY_BYTES') || 65_536;
const guardianTimestampToleranceSeconds =
  explicitPositiveInteger('GUARDIAN_TIMESTAMP_TOLERANCE_SECONDS') || 300;
const guardianBuildShaEnvironment = optional(
  'GUARDIAN_BUILD_SHA_ENV',
  'RAILWAY_GIT_COMMIT_SHA',
);
const guardianBuildShaCandidate = process.env[guardianBuildShaEnvironment] || '';
const guardianBuildSha = /^[A-Fa-f0-9]{7,64}$/.test(guardianBuildShaCandidate)
  ? guardianBuildShaCandidate
  : null;
const guardianApplicationVersion = optional('APP_VERSION', '1.0.0');

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

if (operatorAuthEnabled && !operatorCommandCenterEnabled) {
  console.error('FATAL: OPERATOR_AUTH_ENABLED requires OPERATOR_COMMAND_CENTER_ENABLED=true');
  process.exit(1);
}

if (operatorHealthIncidentsEnabled && !operatorCommandCenterEnabled) {
  console.error('FATAL: OPERATOR_HEALTH_INCIDENTS_ENABLED requires OPERATOR_COMMAND_CENTER_ENABLED=true');
  process.exit(1);
}

if (
  guardianIngestionEnabled
  && (
    !operatorCommandCenterEnabled
    || !operatorAuthEnabled
    || !operatorHealthIncidentsEnabled
  )
) {
  console.error(
    'FATAL: GUARDIAN_INGESTION_ENABLED requires the complete Phase 2 Command Center',
  );
  process.exit(1);
}

if (guardianIngestionEnabled) {
  const validGuardianHost = /^(?=.{1,253}$)(?!-)[a-z0-9.-]+(?<!-)$/.test(guardianHost)
    && !guardianHost.includes('/')
    && guardianHost.includes('.')
    && guardianHost !== operatorHost;
  if (!validGuardianHost) {
    console.error('FATAL: GUARDIAN_HOST must be one exact non-operator hostname');
    process.exit(1);
  }
  if (guardianMaxBodyBytes !== 65_536) {
    console.error('FATAL: GUARDIAN_MAX_BODY_BYTES must equal the frozen v1 limit 65536');
    process.exit(1);
  }
  if (guardianTimestampToleranceSeconds !== 300) {
    console.error(
      'FATAL: GUARDIAN_TIMESTAMP_TOLERANCE_SECONDS must equal the frozen v1 tolerance 300',
    );
    process.exit(1);
  }
  if (
    !/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(guardianBuildShaEnvironment)
    || (isProd && !guardianBuildSha)
  ) {
    console.error('FATAL: Guardian requires an allowlisted deployment build SHA');
    process.exit(1);
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._+/-]{0,63}$/.test(guardianApplicationVersion)) {
    console.error('FATAL: APP_VERSION is invalid for the Guardian protocol');
    process.exit(1);
  }
}

if (operatorCommandCenterEnabled && isProd) {
  const validOperatorHost = /^(?=.{1,253}$)(?!-)[a-z0-9.-]+(?<!-)$/.test(operatorHost)
    && !operatorHost.includes('/')
    && operatorHost.includes('.');
  if (!validOperatorHost) {
    console.error('FATAL: OPERATOR_HOST must be one exact hostname');
    process.exit(1);
  }
  if (!operatorTrustProxyHops) {
    console.error('FATAL: OPERATOR_TRUST_PROXY_HOPS must be an explicit positive integer');
    process.exit(1);
  }
}

if (operatorAuthEnabled) {
  if (!process.env.SUPABASE_PUBLISHABLE_KEY && !process.env.SUPABASE_ANON_KEY) {
    console.error('FATAL: Operator auth requires SUPABASE_PUBLISHABLE_KEY or SUPABASE_ANON_KEY');
    process.exit(1);
  }
  const operatorKey = decodeAes256Key(operatorTokenEncryptionKey);
  if (!operatorKey) {
    console.error('FATAL: OPERATOR_AUTH_TOKEN_ENCRYPTION_KEY must be a 32-byte hex or base64 key');
    process.exit(1);
  }
  const processorKey = decodeAes256Key(process.env.PROCESSOR_ENCRYPTION_KEY || '');
  if (processorKey && operatorKey.equals(processorKey)) {
    console.error('FATAL: Operator auth and processor encryption must use different keys');
    process.exit(1);
  }
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
    secretKey: process.env.STRIPE_SECRET_KEY || '',
    publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || '',
    clientId: process.env.STRIPE_CLIENT_ID || '',
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '',
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

  // Isolated ScaleSafe operator command center. Both flags default off so the
  // Marketplace application can deploy without exposing unfinished routes.
  operator: {
    enabled: operatorCommandCenterEnabled,
    authEnabled: operatorAuthEnabled,
    healthEnabled: operatorHealthIncidentsEnabled,
    host: operatorHost,
    origin: `https://${operatorHost}`,
    trustProxyHops: operatorTrustProxyHops || 0,
    supabaseAuthKey: process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || '',
    tokenEncryptionKey: operatorTokenEncryptionKey,
    authAttemptMinutes: optionalPositiveInteger('OPERATOR_AUTH_ATTEMPT_MINUTES', 10),
    sessionIdleMinutes: optionalPositiveInteger('OPERATOR_SESSION_IDLE_MINUTES', 30),
    sessionAbsoluteMinutes: optionalPositiveInteger('OPERATOR_SESSION_ABSOLUTE_MINUTES', 720),
    invitationHours: optionalPositiveInteger('OPERATOR_INVITATION_HOURS', 72),
  },

  // Independent, signed platform monitoring. This remains disabled until
  // migration 105, an active public credential, and the dedicated host exist.
  guardian: {
    enabled: guardianIngestionEnabled,
    host: guardianHost,
    maxBodyBytes: guardianMaxBodyBytes,
    timestampToleranceSeconds: guardianTimestampToleranceSeconds,
    snapshotTtlSeconds: 300,
    buildShaEnvironment: guardianBuildShaEnvironment,
    buildSha: guardianBuildSha,
    applicationVersion: guardianApplicationVersion,
  },

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
