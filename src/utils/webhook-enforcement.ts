export function isMerchantWebhookSecretEnforced(): boolean {
  if (process.env.REQUIRE_WEBHOOK_SECRET === 'true') return true;
  return process.env.NODE_ENV === 'production';
}
