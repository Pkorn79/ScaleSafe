import { channel } from 'node:diagnostics_channel';

export type ProviderRequestName =
  | 'anthropic'
  | 'ghl'
  | 'nmi'
  | 'stripe'
  | 'whop'
  | 'zoom';

let providerRequestObserver: ((provider: ProviderRequestName) => void) | null = null;

export function setProviderRequestObserver(
  observer: ((provider: ProviderRequestName) => void) | null,
): void {
  providerRequestObserver = observer;
}

function normalizedHostname(value: unknown): string {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return '';
  try {
    const parsed = raw.includes('://') ? new URL(raw) : new URL(`https://${raw}`);
    return parsed.hostname.replace(/\.$/, '');
  } catch {
    return raw.split(':')[0].replace(/\.$/, '');
  }
}

export function classifyProviderHost(value: unknown): ProviderRequestName | null {
  const hostname = normalizedHostname(value);
  if (!hostname) return null;
  if (hostname === 'api.anthropic.com' || hostname.endsWith('.anthropic.com')) return 'anthropic';
  if (hostname.endsWith('.leadconnectorhq.com') || hostname.endsWith('.gohighlevel.com')) return 'ghl';
  if (hostname === 'secure.nmi.com' || hostname.endsWith('.nmi.com')) return 'nmi';
  if (hostname.endsWith('.stripe.com')) return 'stripe';
  if (hostname.endsWith('.whop.com')) return 'whop';
  if (hostname === 'zoom.us' || hostname.endsWith('.zoom.us')) return 'zoom';
  return null;
}

export function observeProviderHost(value: unknown): void {
  const provider = classifyProviderHost(value);
  if (!provider) return;
  try {
    providerRequestObserver?.(provider);
  } catch {
    // Resource accounting must never affect provider traffic.
  }
}

channel('http.client.request.start').subscribe((message: any) => {
  const request = message?.request;
  observeProviderHost(
    request?.getHeader?.('host')
      || request?.host
      || request?._host,
  );
});

channel('undici:request:create').subscribe((message: any) => {
  observeProviderHost(message?.request?.origin);
});
