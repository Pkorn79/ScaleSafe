import { getSupabase } from '../clients/supabase.client';
import { NmiClient } from '../clients/nmi.client';
import { StripeClient } from '../clients/stripe.client';
import { ProcessorInterface } from '../interfaces/processor.interface';
import { ProcessorType, ProcessorConfig } from '../types/processor.types';
import { ProcessorError } from '../errors/processor.error';
import { processorConfigService } from './processor-config.service';
import { assertStripeProcessorConfigMode } from './stripe-connection-mode.service';

interface OfferProcessorHint {
  processor_override: ProcessorType | null;
  nmi_processor_id: string | null;
  stripe_account_id?: string | null;
}

/**
 * Resolves the correct ProcessorInterface instance for a merchant + offer combination.
 *
 * Resolution order:
 * 1. Offer has processor_override -> use that processor type.
 * 2. Merchant has default_processor -> use that processor type.
 * 3. Exactly one active processor config exists -> use that exact config.
 * 4. Otherwise throw a configuration error instead of guessing.
 */
export async function resolveProcessor(
  merchantId: string,
  locationId: string,
  offerHint?: OfferProcessorHint,
): Promise<{ processorType: ProcessorType; config: ProcessorConfig }> {
  const supabase = getSupabase();

  let targetType: ProcessorType | null = offerHint?.processor_override ?? null;

  if (!targetType) {
    const { data: merchant, error } = await supabase
      .from('merchants')
      .select('default_processor')
      .eq('id', merchantId)
      .single();

    if (error) {
      throw new ProcessorError(
        `Failed to look up merchant ${merchantId}: ${error.message}`,
        'nmi',
        'MERCHANT_LOOKUP_FAILED',
      );
    }

    targetType = merchant.default_processor as ProcessorType | null;
  }

  if (!targetType) {
    const { data: configs, error } = await supabase
      .from('processor_configs')
      .select('*')
      .eq('merchant_id', merchantId)
      .eq('location_id', locationId)
      .eq('is_active', true);

    if (error) {
      throw new ProcessorError(
        `Failed to look up processor configs: ${error.message}`,
        'nmi',
        'CONFIG_LOOKUP_FAILED',
      );
    }

    const activeConfigs = configs || [];
    const types = new Set(activeConfigs.map((c: any) => c.processor_type));

    if (types.size === 0) {
      throw new ProcessorError(
        'No processor configured for this merchant. Connect NMI or Stripe first.',
        'nmi',
        'NO_PROCESSOR_CONFIGURED',
      );
    }

    if (activeConfigs.length === 1) {
      const onlyConfig = activeConfigs[0] as ProcessorConfig;
      if (onlyConfig.processor_type === 'stripe') {
        assertStripeProcessorConfigMode(onlyConfig);
      }
      return { processorType: onlyConfig.processor_type, config: onlyConfig };
    }

    if (types.size > 1) {
      throw new ProcessorError(
        'Multiple processors connected but no default set. Configure a default processor in merchant settings.',
        'nmi',
        'NO_DEFAULT_PROCESSOR',
      );
    }

    throw new ProcessorError(
      'Multiple active processor configs found but no default config is set. Choose a default processor config in merchant settings.',
      types.values().next().value as ProcessorType,
      'NO_DEFAULT_PROCESSOR_CONFIG',
    );
  }

  let query = supabase
    .from('processor_configs')
    .select('*')
    .eq('merchant_id', merchantId)
    .eq('location_id', locationId)
    .eq('processor_type', targetType)
    .eq('is_active', true);

  if (targetType === 'nmi' && offerHint?.nmi_processor_id) {
    query = query.eq('nmi_processor_id', offerHint.nmi_processor_id);
  } else if (targetType === 'stripe' && offerHint?.stripe_account_id) {
    query = query.eq('stripe_user_id', offerHint.stripe_account_id);
  } else {
    query = query.eq('is_default', true);
  }

  const { data: configRow, error: configError } = await query.single();

  if (configError || !configRow) {
    throw new ProcessorError(
      targetType === 'nmi' && offerHint?.nmi_processor_id
        ? `No active NMI configuration found for processor ID ${offerHint.nmi_processor_id}.`
        : targetType === 'stripe' && offerHint?.stripe_account_id
          ? `No active Stripe configuration found for connected account ${offerHint.stripe_account_id}.`
          : `No default active ${targetType} configuration found for merchant ${merchantId}.`,
      targetType,
      targetType === 'nmi' && offerHint?.nmi_processor_id
        ? 'CONFIG_NOT_FOUND'
        : targetType === 'stripe' && offerHint?.stripe_account_id
          ? 'CONFIG_NOT_FOUND'
        : 'DEFAULT_CONFIG_NOT_FOUND',
    );
  }

  if (targetType === 'stripe') {
    assertStripeProcessorConfigMode(configRow as ProcessorConfig);
  }

  return { processorType: targetType, config: configRow as ProcessorConfig };
}

/**
 * Creates a ProcessorInterface instance from a resolved config.
 */
export function createProcessorClient(config: ProcessorConfig): ProcessorInterface {
  switch (config.processor_type) {
    case 'nmi': {
      const securityKey = processorConfigService.decryptNmiSecurityKey(config);
      return new NmiClient({
        securityKey,
        tokenizationKey: config.nmi_tokenization_key || '',
        processorId: config.nmi_processor_id || undefined,
      });
    }

    case 'stripe': {
      assertStripeProcessorConfigMode(config);
      if (!config.stripe_user_id) {
        throw new ProcessorError(
          'Stripe config missing stripe_user_id',
          'stripe',
          'MISSING_ACCOUNT_ID',
        );
      }
      return new StripeClient({
        stripeAccountId: config.stripe_user_id,
      });
    }

    default:
      throw new ProcessorError(
        `Unknown processor type: '${config.processor_type}'`,
        config.processor_type as any,
        'UNKNOWN_PROCESSOR',
      );
  }
}
