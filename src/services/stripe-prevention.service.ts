/**
 * Stripe Pre-Dispute Prevention Guidance — Phase S4, Module 9
 *
 * OI enrollment checklist, CE 3.0 field validation,
 * RDR ruleset configuration interface, Ethoca alert readiness check.
 * This service provides enrollment guidance and readiness checking —
 * NOT direct enrollment (that happens in Stripe Dashboard).
 */

import { getSupabase } from '../clients/supabase.client';
import { logger } from '../utils/logger';
import type { EnrollmentChecklist, ChecklistStep, PreventionCoverage, Ce30Readiness } from '../types/stripe-defense.types';

export class StripePreventionService {
  /**
   * Generate the OI (Order Insights) enrollment checklist for a merchant.
   */
  async getOiEnrollmentChecklist(merchantId: string, locationId: string): Promise<EnrollmentChecklist> {
    const supabase = getSupabase();
    const steps: ChecklistStep[] = [];

    // Step 1: Stripe connected?
    const { data: merchant } = await supabase
      .from('merchants')
      .select('stripe_connected')
      .eq('id', merchantId)
      .eq('location_id', locationId)
      .single();

    const stripeConnected = !!merchant?.stripe_connected;

    steps.push({
      id: 'stripe_connected',
      title: 'Connect Stripe account',
      complete: stripeConnected,
      instructions: stripeConnected
        ? 'Stripe account connected.'
        : 'Connect your Stripe account via Settings > Payment Processing.',
    });

    // Step 2: CE 3.0 fields being captured?
    const ce30Ready = await this.checkCe30Readiness(merchantId, locationId);
    steps.push({
      id: 'ce30_fields',
      title: 'CE 3.0 transaction fields captured',
      complete: ce30Ready.complete,
      instructions: ce30Ready.complete
        ? 'All required fields (IP, email, description) are being captured on transactions.'
        : `${ce30Ready.missing.join(', ')} missing from recent transactions. These are required for CE 3.0 dispute blocking.`,
    });

    // Step 3: OI enrollment in Stripe Dashboard
    steps.push({
      id: 'oi_enrollment',
      title: 'Enable Order Insights in Stripe Dashboard',
      complete: false, // ScaleSafe can't check this directly
      instructions: 'Navigate to Stripe Dashboard > Disputes > Dispute Prevention. Complete the OI enrollment form with your business name, URL, phone number, and email.',
      actionUrl: 'https://dashboard.stripe.com/settings/disputes',
    });

    // Step 4: Repeat client rate assessment
    const { data: audit } = await supabase
      .from('risk_audit_results')
      .select('score_repeat_client_rate, repeat_customer_count, unique_customer_count')
      .eq('merchant_id', merchantId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    const repeatRate = audit?.unique_customer_count
      ? (audit.repeat_customer_count / audit.unique_customer_count) * 100
      : 0;

    steps.push({
      id: 'repeat_clients',
      title: 'Repeat client rate assessment',
      complete: repeatRate > 15,
      instructions: repeatRate > 15
        ? `${repeatRate.toFixed(0)}% repeat client rate — strong CE 3.0 eligibility. Your repeat clients' Visa transactions can be fully blocked from disputes.`
        : `${repeatRate.toFixed(0)}% repeat client rate. Build repeat business to unlock CE 3.0 dispute blocking power.`,
    });

    return {
      module: 'Order Insights (OI)',
      network: 'Visa',
      steps,
      overallProgress: Math.round((steps.filter(s => s.complete).length / steps.length) * 100),
    };
  }

  /**
   * Generate RDR (Rapid Dispute Resolution) enrollment guidance.
   */
  async getRdrEnrollmentChecklist(merchantId: string, locationId: string): Promise<EnrollmentChecklist> {
    const supabase = getSupabase();
    const steps: ChecklistStep[] = [];

    // Step 1: Stripe connected
    const { data: merchant } = await supabase
      .from('merchants')
      .select('stripe_connected')
      .eq('id', merchantId)
      .eq('location_id', locationId)
      .single();

    steps.push({
      id: 'stripe_connected',
      title: 'Connect Stripe account',
      complete: !!merchant?.stripe_connected,
      instructions: merchant?.stripe_connected
        ? 'Stripe account connected.'
        : 'Connect your Stripe account via Settings > Payment Processing.',
    });

    steps.push({
      id: 'rdr_beta_request',
      title: 'Request RDR beta access',
      complete: false,
      instructions: 'Email dispute-prevention-beta@stripe.com to request RDR access. Mention you are a high-ticket service provider and want to configure custom RDR rules.',
      actionUrl: 'mailto:dispute-prevention-beta@stripe.com',
    });

    steps.push({
      id: 'rdr_ruleset',
      title: 'Configure RDR ruleset',
      complete: false,
      instructions: 'Once approved, ScaleSafe will help configure your RDR rules. Recommended: auto-refund transactions under $500 with fraud reason, over 120 days old, or from repeat disputers. Fight high-value transactions with strong evidence.',
    });

    return {
      module: 'Rapid Dispute Resolution (RDR)',
      network: 'Visa',
      steps,
      overallProgress: Math.round((steps.filter(s => s.complete).length / steps.length) * 100),
    };
  }

  /**
   * Generate Ethoca alert enrollment checklist.
   */
  async getEthocaEnrollmentChecklist(merchantId: string, locationId: string): Promise<EnrollmentChecklist> {
    const supabase = getSupabase();
    const steps: ChecklistStep[] = [];

    const { data: merchant } = await supabase
      .from('merchants')
      .select('stripe_connected')
      .eq('id', merchantId)
      .eq('location_id', locationId)
      .single();

    steps.push({
      id: 'stripe_connected',
      title: 'Connect Stripe account',
      complete: !!merchant?.stripe_connected,
      instructions: merchant?.stripe_connected
        ? 'Stripe account connected.'
        : 'Connect your Stripe account via Settings > Payment Processing.',
    });

    steps.push({
      id: 'ethoca_enrollment',
      title: 'Enable Ethoca Alerts in Stripe Dashboard',
      complete: false,
      instructions: 'Navigate to Stripe Dashboard > Disputes > Dispute Prevention. Enable Ethoca Alerts for Mastercard dispute prevention. Configure auto-resolve rules.',
      actionUrl: 'https://dashboard.stripe.com/settings/disputes',
    });

    steps.push({
      id: 'ethoca_response',
      title: 'Verify 24-hour response capability',
      complete: false,
      instructions: 'Ethoca alerts must be responded to within 24 hours. ScaleSafe monitors these webhooks automatically and will alert you immediately when an Ethoca alert fires.',
    });

    return {
      module: 'Ethoca Alerts',
      network: 'Mastercard',
      steps,
      overallProgress: Math.round((steps.filter(s => s.complete).length / steps.length) * 100),
    };
  }

  /**
   * CE 3.0 readiness check — analyze recent vault entries for required fields.
   */
  async checkCe30Readiness(merchantId: string, locationId: string): Promise<Ce30Readiness> {
    const { data: entries } = await getSupabase()
      .from('stripe_evidence_vault')
      .select('customer_ip, customer_email, offer_description, ce30_fields_complete')
      .eq('merchant_id', merchantId)
      .eq('location_id', locationId)
      .order('created_at', { ascending: false })
      .limit(20);

    if (!entries?.length) {
      return { complete: false, missing: ['No transactions found'], eligibleTransactionPercent: 0 };
    }

    const missing: string[] = [];
    const withIp = entries.filter((e: any) => !!e.customer_ip).length;
    const withEmail = entries.filter((e: any) => !!e.customer_email).length;
    const withDesc = entries.filter((e: any) => !!e.offer_description).length;

    if (withIp < entries.length * 0.8) missing.push(`IP address (${withIp}/${entries.length} transactions)`);
    if (withEmail < entries.length * 0.8) missing.push(`Email (${withEmail}/${entries.length} transactions)`);
    if (withDesc < entries.length * 0.8) missing.push(`Description (${withDesc}/${entries.length} transactions)`);

    const eligible = entries.filter((e: any) => e.ce30_fields_complete).length;
    const eligiblePercent = Math.round((eligible / entries.length) * 100);

    return {
      complete: missing.length === 0,
      missing,
      eligibleTransactionPercent: eligiblePercent,
    };
  }

  /**
   * Get full prevention coverage summary across all three networks/programs.
   */
  async getPreventionCoverage(merchantId: string, locationId: string): Promise<PreventionCoverage> {
    const [oi, rdr, ethoca] = await Promise.all([
      this.getOiEnrollmentChecklist(merchantId, locationId),
      this.getRdrEnrollmentChecklist(merchantId, locationId),
      this.getEthocaEnrollmentChecklist(merchantId, locationId),
    ]);

    const totalSteps = oi.steps.length + rdr.steps.length + ethoca.steps.length;
    const completedSteps = oi.steps.filter(s => s.complete).length
      + rdr.steps.filter(s => s.complete).length
      + ethoca.steps.filter(s => s.complete).length;

    return {
      visa: { oi, rdr },
      mastercard: { ethoca },
      overallCoverage: Math.round((completedSteps / totalSteps) * 100),
    };
  }
}

export const stripePreventionService = new StripePreventionService();
