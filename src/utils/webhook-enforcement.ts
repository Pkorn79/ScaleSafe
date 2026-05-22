export function isMerchantWebhookSecretEnforced(): boolean {
  if (process.env.REQUIRE_WEBHOOK_SECRET === 'true') return true;
  return false;
}
