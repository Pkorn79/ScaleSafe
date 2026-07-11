import { CanonicalEvidenceEvent } from '../types/evidence-connector.types';
import { IntegrationCapability } from './provider-catalog';

export interface DiscoveredProviderResource {
  type: string;
  id: string;
  name: string;
  metadata?: Record<string, unknown>;
}

export interface ProviderCommerceEvent {
  sourceEventId: string;
  eventType: 'purchase_paid' | 'subscription_created' | 'payment_succeeded' | 'payment_failed'
    | 'subscription_cancelled' | 'full_refund' | 'partial_refund' | 'dunning_exhausted';
  occurredAt: string;
  externalCustomerId?: string;
  externalEnrollmentId?: string;
  externalResourceId?: string;
  externalTransactionId?: string;
  amountCents?: number;
  currency?: string;
}

export interface ProviderAdapter {
  readonly key: string;
  readonly capabilities: IntegrationCapability[];
  buildAuthorizationUrl?(state: string, redirectUri: string): Promise<string> | string;
  exchangeAuthorizationCode?(code: string, redirectUri: string): Promise<Record<string, unknown>>;
  discoverResources?(authorization: Record<string, unknown>): Promise<DiscoveredProviderResource[]>;
  verifyWebhook?(rawBody: Buffer, headers: Record<string, unknown>, authorization: Record<string, unknown>): Promise<boolean>;
  normalizeEvidenceWebhook?(payload: Record<string, unknown>): Promise<CanonicalEvidenceEvent[]>;
  normalizeCommerceWebhook?(payload: Record<string, unknown>): Promise<ProviderCommerceEvent[]>;
  grantAccess?(input: Record<string, unknown>): Promise<{ externalUserId?: string; state: 'active' | 'pending' }>;
  revokeAccess?(input: Record<string, unknown>): Promise<{ state: 'revoked' | 'pending' }>;
  readAccess?(input: Record<string, unknown>): Promise<'active' | 'revoked' | 'pending' | 'unknown'>;
}

const adapters = new Map<string, ProviderAdapter>();

export const providerAdapterRegistry = {
  register(adapter: ProviderAdapter): void {
    adapters.set(adapter.key, adapter);
  },
  get(providerKey: string): ProviderAdapter | null {
    return adapters.get(providerKey) || null;
  },
  has(providerKey: string): boolean {
    return adapters.has(providerKey);
  },
};
