const GHL_TRIGGER_HOST = 'services.leadconnectorhq.com';
const GHL_TRIGGER_PATH_PREFIX = '/workflows-marketplace/triggers/execute';

export function isAllowedTriggerSubscriptionUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:'
      && url.hostname === GHL_TRIGGER_HOST
      && url.pathname.startsWith(GHL_TRIGGER_PATH_PREFIX);
  } catch {
    return false;
  }
}
