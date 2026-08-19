import { getSupabase } from '../clients/supabase.client';
import { config } from '../config';
import { ProcessorError } from '../errors/processor.error';
import type { ProcessorConfig } from '../types/processor.types';

export function expectedStripeLiveMode(): boolean {
  if (typeof config.stripe.liveMode !== 'boolean') {
    throw new ProcessorError(
      'Stripe payment mode is not configured. Contact ScaleSafe support.',
      'stripe',
      'STRIPE_MODE_NOT_CONFIGURED',
    );
  }
  return config.stripe.liveMode;
}

export function stripeConnectionModeMatches(livemode: unknown): boolean {
  return typeof livemode === 'boolean'
    && livemode === expectedStripeLiveMode();
}

export function assertStripeProcessorConfigMode(
  processorConfig: Pick<ProcessorConfig, 'stripe_livemode'>,
): void {
  const expected = expectedStripeLiveMode();
  if (typeof processorConfig.stripe_livemode !== 'boolean') {
    throw new ProcessorError(
      'This Stripe connection predates payment-mode verification. Reconnect Stripe before continuing.',
      'stripe',
      'STRIPE_CONNECTION_MODE_UNKNOWN',
    );
  }
  if (processorConfig.stripe_livemode !== expected) {
    throw new ProcessorError(
      `This is a ${processorConfig.stripe_livemode ? 'live' : 'test'} Stripe connection, but ScaleSafe is running in ${expected ? 'live' : 'test'} mode. Reconnect Stripe before continuing.`,
      'stripe',
      'STRIPE_CONNECTION_MODE_MISMATCH',
    );
  }
}

export async function requireActiveStripeConnection(
  merchantId: string,
  locationId?: string,
): Promise<ProcessorConfig> {
  let query = getSupabase()
    .from('processor_configs')
    .select('*')
    .eq('merchant_id', merchantId)
    .eq('processor_type', 'stripe')
    .eq('is_active', true);

  if (locationId) query = query.eq('location_id', locationId);

  const { data, error } = await query.maybeSingle();
  if (error) {
    throw new ProcessorError(
      `Failed to verify the Stripe connection: ${error.message}`,
      'stripe',
      error.code || 'STRIPE_CONNECTION_LOOKUP_FAILED',
    );
  }
  if (!data?.stripe_user_id) {
    throw new ProcessorError(
      'No active Stripe connection was found for this merchant.',
      'stripe',
      'STRIPE_CONNECTION_NOT_FOUND',
    );
  }

  assertStripeProcessorConfigMode(data as ProcessorConfig);
  return data as ProcessorConfig;
}
