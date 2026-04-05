/**
 * Stripe Statement Descriptor Optimization — Phase S4, Module 7
 *
 * Formats merchant prefix + offer-specific suffix for PaymentIntents.
 * Reduces "unrecognized charge" disputes by ensuring cardholders see
 * a recognizable business name + program description on their statement.
 */

const Stripe = require('stripe');
import { getSupabase } from '../clients/supabase.client';
import { logger } from '../utils/logger';
import type { DescriptorAnalysis } from '../types/stripe-defense.types';

const stripe = Stripe(process.env.STRIPE_SECRET_KEY || '', {
  apiVersion: '2024-12-18.acacia',
});

export class StripeDescriptorService {
  /**
   * Format a statement descriptor suffix for an offer.
   * Stripe allows max 22 chars total (prefix + suffix).
   * Account prefix is typically 10-12 chars, leaving ~10 for suffix.
   */
  formatDescriptorSuffix(offerTitle: string): string {
    if (!offerTitle || !offerTitle.trim()) return 'PROGRAM';

    const cleaned = offerTitle
      .toUpperCase()
      .replace(/[^A-Z0-9\s-]/g, '')   // Remove special chars
      .replace(/\s+/g, '-')            // Spaces to hyphens
      .substring(0, 10)                // Cap at 10 chars
      .replace(/-$/, '');              // Remove trailing hyphen

    return cleaned || 'PROGRAM';
  }

  /**
   * Get the full descriptor that will appear on cardholder's statement.
   */
  getFullDescriptor(merchantDescriptorPrefix: string, offerTitle: string): string {
    const suffix = this.formatDescriptorSuffix(offerTitle);
    return `${merchantDescriptorPrefix}* ${suffix}`;
  }

  /**
   * Recommend a descriptor prefix for the merchant based on business name.
   * Strips common legal suffixes and formats for statement display.
   */
  recommendDescriptorPrefix(businessName: string): string {
    if (!businessName || !businessName.trim()) return '';

    return businessName
      .toUpperCase()
      .replace(/\s*(LLC|INC|CO|CORP|LTD|LP|GROUP|SERVICES|CONSULTING)\s*\.?$/i, '')
      .replace(/[^A-Z0-9\s]/g, '')
      .trim()
      .substring(0, 12)
      .trim();
  }

  /**
   * Analyze current descriptor quality for a merchant's Stripe account.
   * Used by the risk audit to surface descriptor issues.
   */
  async analyzeDescriptorQuality(merchantId: string, locationId: string): Promise<DescriptorAnalysis> {
    const supabase = getSupabase();

    const { data: merchant } = await supabase
      .from('merchants')
      .select('stripe_user_id, business_legal_name, business_name')
      .eq('id', merchantId)
      .eq('location_id', locationId)
      .single();

    if (!merchant?.stripe_user_id) {
      return { score: 0, currentPrefix: '', recommendation: 'Connect Stripe to analyze descriptors' };
    }

    try {
      const account = await stripe.accounts.retrieve(merchant.stripe_user_id);

      const descriptor = account.settings?.payments?.statement_descriptor || '';
      const descriptorShort = account.settings?.payments?.statement_descriptor_prefix || '';

      if (!descriptor && !descriptorShort) {
        return {
          score: 0,
          currentPrefix: '',
          recommendation: 'No statement descriptor configured. Customers will see a generic charge description.',
        };
      }

      // Check if descriptor looks like a real business name
      const isGeneric = descriptor.length < 5 || descriptor === 'STRIPE' || /^[A-Z]{2,3}\*/.test(descriptor);

      return {
        score: isGeneric ? 30 : 70,
        currentPrefix: descriptor,
        recommendation: isGeneric
          ? `Your current descriptor "${descriptor}" may not be recognizable to customers. Recommended: "${this.recommendDescriptorPrefix(merchant.business_legal_name || merchant.business_name || 'Your Business')}"`
          : `Your descriptor "${descriptor}" looks good. ScaleSafe will add per-offer suffixes automatically.`,
      };
    } catch (err) {
      logger.error({ err, merchantId }, 'Failed to analyze descriptor quality');
      return { score: 0, currentPrefix: '', recommendation: 'Unable to check descriptor — verify Stripe connection' };
    }
  }
}

export const stripeDescriptorService = new StripeDescriptorService();
