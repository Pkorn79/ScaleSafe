/**
 * Test-only environment bootstrap.
 * Ensures config validation does not terminate test runs when .env is absent.
 */

const defaults: Record<string, string> = {
  SUPABASE_URL: 'https://test-project.supabase.co',
  SUPABASE_SERVICE_KEY: 'test_supabase_service_role_key_1234567890',
  GHL_CLIENT_ID: 'test_ghl_client_id_123',
  GHL_CLIENT_SECRET: 'test_ghl_client_secret_456',
  GHL_APP_ID: 'test_ghl_app_id_789',
  ENCRYPTION_KEY: 'test_encryption_key_abcdefghijklmnopqrstuvwxyz',
  // Current config.ts expects these names:
  GHL_APP_CLIENT_ID: 'test_ghl_app_client_id_123',
  GHL_APP_CLIENT_SECRET: 'test_ghl_app_client_secret_456',
  GHL_APP_SSO_KEY: 'test_ghl_app_sso_key_789',
  GHL_TRIGGER_SUBSCRIPTION_SECRET: 'test_trigger_subscription_secret_1234567890',
  PUBLIC_ACTION_TOKEN_SECRET: 'test_public_action_secret_1234567890',
  STRIPE_SECRET_KEY: 'sk_test_51MockedScaleSafeStripeKey1234567890',
  PROCESSOR_ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  ZOOM_CLIENT_ID: 'zoom_test_client_id',
  ZOOM_CLIENT_SECRET: 'zoom_test_client_secret',
  ZOOM_WEBHOOK_SECRET_TOKEN: 'zoom_test_webhook_secret',
  ALLOW_DEV_LOCATION_AUTH: 'true',
};

for (const [key, value] of Object.entries(defaults)) {
  if (!process.env[key]) {
    process.env[key] = value;
  }
}
