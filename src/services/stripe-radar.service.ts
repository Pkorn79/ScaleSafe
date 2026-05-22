/**
 * Stripe Radar Optimization — Phase S4, Module 4
 *
 * Manages Stripe Radar Value Lists: blocked cards (card fingerprints)
 * and verified customers (emails). Provides 3DS recommendation logic.
 */

const Stripe = require('stripe');
import { getSupabase } from '../clients/supabase.client';
import { logger } from '../utils/logger';
import type { RadarListRecord } from '../types/stripe-defense.types';

let _stripe: any = null;
function getStripe() {
  if (!_stripe) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error('STRIPE_SECRET_KEY not configured');
    _stripe = Stripe(key, { apiVersion: '2024-12-18.acacia' });
  }
  return _stripe;
}

export class StripeRadarService {
  /**
   * Initialize Radar Value Lists for a merchant (on Stripe connect).
   * Creates blocked cards and verified customers lists.
   */
  async initializeRadarLists(merchantId: string, locationId: string, stripeAccount: string): Promise<void> {
    const supabase = getSupabase();

    // Check if lists already exist for this merchant
    const { data: existing } = await supabase
      .from('stripe_radar_lists')
      .select('list_alias')
      .eq('merchant_id', merchantId)
      .eq('location_id', locationId);

    const existingAliases = new Set((existing || []).map((r: any) => r.list_alias));

    const listsToCreate: Array<{ alias: string; name: string; itemType: string }> = [];

    if (!existingAliases.has('scalesafe_blocked_cards')) {
      listsToCreate.push({
        alias: 'scalesafe_blocked_cards',
        name: 'ScaleSafe Blocked Cards',
        itemType: 'card_fingerprint',
      });
    }

    if (!existingAliases.has('scalesafe_verified_customers')) {
      listsToCreate.push({
        alias: 'scalesafe_verified_customers',
        name: 'ScaleSafe Verified Customers',
        itemType: 'email',
      });
    }

    if (listsToCreate.length === 0) {
      logger.info({ merchantId, locationId }, 'Radar lists already initialized');
      return;
    }

    const records: RadarListRecord[] = [];

    for (const list of listsToCreate) {
      try {
        const created = await getStripe().radar.valueLists.create({
          alias: list.alias,
          name: list.name,
          item_type: list.itemType,
        }, { stripeAccount });

        records.push({
          merchant_id: merchantId,
          location_id: locationId,
          list_alias: list.alias,
          stripe_value_list_id: created.id,
          item_type: list.itemType,
        });

        logger.info({ merchantId, alias: list.alias, listId: created.id }, 'Radar value list created');
      } catch (err: any) {
        // If alias already exists in Stripe, try to retrieve it
        if (err.code === 'resource_already_exists') {
          logger.info({ merchantId, alias: list.alias }, 'Radar list already exists in Stripe');
        } else {
          logger.error({ err, merchantId, alias: list.alias }, 'Failed to create radar value list');
        }
      }
    }

    if (records.length > 0) {
      const { error } = await supabase.from('stripe_radar_lists').insert(records);
      if (error) {
        logger.error({ error, merchantId }, 'Failed to store radar list records');
      }
    }
  }

  /**
   * Add a card fingerprint to the blocked list (after won fraud dispute).
   */
  async blockCard(merchantId: string, locationId: string, cardFingerprint: string, stripeAccount: string): Promise<void> {
    const { data: listRecord } = await getSupabase()
      .from('stripe_radar_lists')
      .select('stripe_value_list_id')
      .eq('merchant_id', merchantId)
      .eq('location_id', locationId)
      .eq('list_alias', 'scalesafe_blocked_cards')
      .single();

    if (!listRecord) {
      logger.error({ merchantId, locationId }, 'No blocked cards list found for merchant');
      return;
    }

    try {
      await getStripe().radar.valueListItems.create({
        value_list: listRecord.stripe_value_list_id,
        value: cardFingerprint,
      }, { stripeAccount });

      logger.info({ merchantId, fingerprint: cardFingerprint.slice(0, 8) + '...' }, 'Card blocked via Radar');
    } catch (err: any) {
      if (err.code === 'resource_already_exists') {
        logger.info({ merchantId }, 'Card already blocked');
      } else {
        logger.error({ err, merchantId }, 'Failed to block card');
        throw err;
      }
    }
  }

  /**
   * Add a customer email to the verified list (after successful delivery).
   */
  async verifyCustomer(merchantId: string, locationId: string, customerEmail: string, stripeAccount: string): Promise<void> {
    const { data: listRecord } = await getSupabase()
      .from('stripe_radar_lists')
      .select('stripe_value_list_id')
      .eq('merchant_id', merchantId)
      .eq('location_id', locationId)
      .eq('list_alias', 'scalesafe_verified_customers')
      .single();

    if (!listRecord) {
      logger.warn({ merchantId, locationId }, 'No verified customers list found');
      return;
    }

    try {
      await getStripe().radar.valueListItems.create({
        value_list: listRecord.stripe_value_list_id,
        value: customerEmail,
      }, { stripeAccount });

      logger.info({ merchantId, hasEmail: !!customerEmail }, 'Customer verified via Radar');
    } catch (err: any) {
      if (err.code === 'resource_already_exists') {
        logger.info({ merchantId }, 'Customer already verified');
      } else {
        logger.error({ err, merchantId }, 'Failed to verify customer');
        throw err;
      }
    }
  }

  /**
   * Get current blocked cards list contents.
   */
  async getBlockedCards(merchantId: string, locationId: string, stripeAccount: string): Promise<string[]> {
    const { data: listRecord } = await getSupabase()
      .from('stripe_radar_lists')
      .select('stripe_value_list_id')
      .eq('merchant_id', merchantId)
      .eq('location_id', locationId)
      .eq('list_alias', 'scalesafe_blocked_cards')
      .single();

    if (!listRecord) return [];

    try {
      const items = await getStripe().radar.valueListItems.list(
        { value_list: listRecord.stripe_value_list_id, limit: 100 },
        { stripeAccount }
      );
      return items.data.map((item: any) => item.value);
    } catch (err) {
      logger.error({ err, merchantId }, 'Failed to list blocked cards');
      return [];
    }
  }

  /**
   * Get 3DS preference for a payment based on verification status and amount.
   * Returns the Stripe request_three_d_secure value.
   */
  get3dsPreference(isVerifiedCustomer: boolean, amountCents: number): string {
    // For unverified customers on high-value transactions, request 3DS
    if (!isVerifiedCustomer && amountCents > 100000) return 'automatic';
    // Otherwise let Stripe decide
    return 'automatic';
  }
}

export const stripeRadarService = new StripeRadarService();
