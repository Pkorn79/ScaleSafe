import { getSupabase } from '../clients/supabase.client';
import { NmiClient } from '../clients/nmi.client';
import { StripeClient } from '../clients/stripe.client';
import { ProcessorInterface } from '../interfaces/processor.interface';
import { ProcessorType, ProcessorConfig } from '../types/processor.types';
import { ProcessorError } from '../errors/processor.error';
import { processorConfigService } from './processor-config.service';
import { logger } from '../utils/logger';

interface OfferProcessorHint {
  processor_override: ProcessorType | null;
  nmi_processor_id: string | null;
}

/**
 * Resolves the correct ProcessorInterface instance for a merchant + offer combination.
 *
 * Resolution order:
 * 1. Offer has processor_override → use that
 * 2. Merchant has default_processor → use that
 * 3. Only one processor connected → use that
 * 4. Both connected, no default → throw config error
 */
export async function resolveProcessor(
  merchantId: string,
  locationId: string,
  offerHint?: OfferProcessorHint,
): Promise<{ processorType: ProcessorType; config: ProcessorConfig }> {
  const supabase = getSupabase();

  // Step 1: Check offer-level override
  let targetType: ProcessorType | null = offerHint?.processor_override ?? null;

  // Step 2: If no offer override, check merchant default
  if (!targetType) {
    const { data: merchant, error } = await supabase
      .from('merchants')
      .select('default_processor')
      .eq('id', merchantId)
      .single();

    if (error) {
      throw new ProcessorError(
        `Failed to look up merchant ${merchantId}: ${error.message}`,
        'nmi', // arbitrary — we don't know the processor yet
        'MERCHANT_LOOKUP_FAILED',
      );
    }

    targetType = merchant.default_processor as ProcessorType | null;
  }

  // Step 3: If still no target, check what's connected
  if (!targetType) {
    const { data: configs, error } = await supabase
      .from('processor_configs')
      .select('processor_type')
      .eq('merchant_id', merchantId)
      .eq('is_active', true);

    if (error) {
      throw new ProcessorError(
        `Failed to look up processor configs: ${error.message}`,
        'nmi',
        'CONFIG_LOOKUP_FAILED',
      );
    }

    const types = new Set((configs || []).map((c: any) => c.processor_type));

    if (types.size === 0) {
      throw new ProcessorError(
        'No processor configured for this merchant. Connect NMI or Stripe first.',
        'nmi',
        'NO_PROCESSOR_CONFIGURED',
      );
    }

    if (types.size === 1) {
      targetType = types.values().next().value as ProcessorType;
    } else {
      throw new ProcessorError(
        'Multiple processors connected but no default set. Configure a default processor in merchant settings.',
        'nmi',
        'NO_DEFAULT_PROCESSOR',
      );
    }
  }

  // Now resolve the specific config row
  let query = supabase
    .from('processor_configs')
    .select('*')
    .eq('merchant_id', merchantId)
    .eq('processor_type', targetType)
    .eq('is_active', true);

  // For NMI, resolve multi-MID routing
  if (targetType === 'nmi' && offerHint?.nmi_processor_id) {
    query = query.eq('nmi_processor_id', offerHint.nmi_processor_id);
  } else {
    query = query.eq('is_default', true);
  }

  const { data: configRow, error: configError } = await query.single();

  if (configError || !configRow) {
    // Fallback: if no default found, grab the first active one
    const { data: fallback, error: fbError } = await supabase
      .from('processor_configs')
      .select('*')
      .eq('merchant_id', merchantId)
      .eq('processor_type', targetType)
      .eq('is_active', true)
      .limit(1)
      .single();

    if (fbError || !fallback) {
      throw new ProcessorError(
        `No active ${targetType} configuration found for merchant ${merchantId}.`,
        targetType,
        'CONFIG_NOT_FOUND',
      );
    }

    logger.warn(
      { merchantId, processorType: targetType },
      'No default processor config found, using first active config',
    );

    return { processorType: targetType, config: fallback as ProcessorConfig };
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
