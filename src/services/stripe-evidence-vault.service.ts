import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { getSupabase } from '../clients/supabase.client';
import { config } from '../config';
import { EvidenceScoreInput } from '../types/stripe-defense.types';
import { logger } from '../utils/logger';

const Stripe = require('stripe');

function wrapText(text: string, maxChars: number): string[] {
  if (!text) return [];
  const words = text.split(' ');
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    if ((current + ' ' + word).trim().length > maxChars) {
      lines.push(current.trim());
      current = word;
    } else {
      current += ' ' + word;
    }
  }
  if (current.trim()) lines.push(current.trim());
  return lines;
}

export const stripeEvidenceVaultService = {
  computeEvidenceScore(input: EvidenceScoreInput): number {
    let score = 0;
    if (input.hasTermsFile) score += 20;
    if (input.hasContractFile) score += 20;
    if (input.hasSessionLogs) score += 20;
    if (input.hasCommunicationFile) score += 15;
    if (input.metadataComplete) score += 15;
    if (input.hasBillingAddress) score += 10;
    return score;
  },

  async createVaultEntry(params: {
    merchantId: string;
    stripePaymentIntentId: string;
    stripeChargeId?: string;
    stripeCustomerId?: string;
    offerId?: string;
    enrollmentPacketId?: string;
    customerName?: string;
    customerEmail?: string;
    customerIp?: string;
    customerBillingAddress?: object;
    offerTitle?: string;
    offerDescription?: string;
    termsAccepted?: boolean;
    termsAcceptedAt?: string;
    contractSigned?: boolean;
    refundPolicyText?: string;
    serviceDeliveryModel?: string;
    serviceStartDate?: string;
  }): Promise<any> {
    // "Fields complete" means we captured the identity data CE 3.0 *matching* needs
    // (IP, email, description). It is NOT eligibility: real CE 3.0 requires two prior
    // undisputed transactions 120-365 days old with matching elements, which we do not
    // verify yet — so ce30_eligible is always written false until that engine exists.
    const ce30Complete = !!(params.customerIp && params.customerEmail && params.offerDescription);
    const evidenceScore = this.computeEvidenceScore({
      hasTermsFile: false,
      hasContractFile: false,
      hasSessionLogs: false,
      hasCommunicationFile: false,
      metadataComplete: ce30Complete,
      hasBillingAddress: !!params.customerBillingAddress,
    });

    const { data, error } = await getSupabase()
      .from('stripe_evidence_vault')
      .insert({
        merchant_id: params.merchantId,
        stripe_payment_intent_id: params.stripePaymentIntentId,
        stripe_charge_id: params.stripeChargeId || null,
        stripe_customer_id: params.stripeCustomerId || null,
        offer_id: params.offerId || null,
        enrollment_packet_id: params.enrollmentPacketId || null,
        customer_name: params.customerName || null,
        customer_email: params.customerEmail || null,
        customer_ip: params.customerIp || null,
        customer_billing_address: params.customerBillingAddress || null,
        offer_title: params.offerTitle || null,
        offer_description: params.offerDescription || null,
        terms_accepted: params.termsAccepted || false,
        terms_accepted_at: params.termsAcceptedAt || null,
        contract_signed: params.contractSigned || false,
        refund_policy_text: params.refundPolicyText || null,
        service_delivery_model: params.serviceDeliveryModel || null,
        service_start_date: params.serviceStartDate || null,
        ce30_eligible: false,
        ce30_fields_complete: ce30Complete,
        metadata_written: true,
        evidence_score: evidenceScore,
      })
      .select()
      .single();

    if (error) {
      logger.error({ err: error }, 'Failed to create evidence vault entry');
      throw error;
    }

    return data;
  },

  async createVaultEntryFromWebhook(paymentIntent: any, merchant: any): Promise<void> {
    try {
      const supabase = getSupabase();

      // Check for existing entry
      const { data: existing } = await supabase
        .from('stripe_evidence_vault')
        .select('id')
        .eq('stripe_payment_intent_id', paymentIntent.id)
        .single();

      if (existing) return;

      const metadata = paymentIntent.metadata || {};
      const chargeId = typeof paymentIntent.latest_charge === 'string'
        ? paymentIntent.latest_charge
        : paymentIntent.latest_charge?.id || null;
      const customerId = typeof paymentIntent.customer === 'string'
        ? paymentIntent.customer
        : paymentIntent.customer?.id || null;

      const hasIp = !!metadata.customer_ip;
      const hasEmail = !!paymentIntent.receipt_email;
      const hasDescription = !!paymentIntent.description;
      const ce30Complete = hasIp && hasEmail && hasDescription;

      const evidenceScore = this.computeEvidenceScore({
        hasTermsFile: false,
        hasContractFile: false,
        hasSessionLogs: false,
        hasCommunicationFile: false,
        metadataComplete: ce30Complete,
        hasBillingAddress: false,
      });

      const { error } = await supabase.from('stripe_evidence_vault').insert({
        merchant_id: merchant.id,
        stripe_payment_intent_id: paymentIntent.id,
        stripe_charge_id: chargeId,
        stripe_customer_id: customerId,
        customer_email: paymentIntent.receipt_email || null,
        offer_title: paymentIntent.description || null,
        offer_description: metadata.offer_description || paymentIntent.description || null,
        customer_ip: metadata.customer_ip || null,
        terms_accepted: metadata.terms_accepted === 'true',
        terms_accepted_at: metadata.terms_accepted_at || null,
        ce30_eligible: false,
        ce30_fields_complete: ce30Complete,
        metadata_written: false,
        evidence_score: evidenceScore,
      });

      if (error) {
        logger.error({ err: error, piId: paymentIntent.id, merchantId: merchant.id }, 'Failed to create vault entry from webhook');
      }
    } catch (err: any) {
      logger.error({ err: err.message, piId: paymentIntent.id, merchantId: merchant.id }, 'Unexpected error creating vault entry from webhook');
    }
  },

  async getByPaymentIntentId(paymentIntentId: string): Promise<any | null> {
    const { data } = await getSupabase()
      .from('stripe_evidence_vault')
      .select('*')
      .eq('stripe_payment_intent_id', paymentIntentId)
      .single();
    return data;
  },

  async updateEvidenceFiles(paymentIntentId: string, updates: Record<string, any>): Promise<void> {
    await getSupabase()
      .from('stripe_evidence_vault')
      .update(updates)
      .eq('stripe_payment_intent_id', paymentIntentId);
  },

  // ─── File Upload Methods (Phase S2) ────────────────────

  async uploadOfferTerms(params: {
    merchantId: string;
    stripeUserId: string;
    offerId: string;
    offerTitle: string;
    offerDescription: string;
    refundPolicy: string;
    tcClauses: string[];
    pricing: { type: string; amount: number; installments?: number };
  }): Promise<string | null> {
    if (!params.stripeUserId) return null;

    const pdfBuffer = await this.generateOfferTermsPdf(params);
    const stripe = new Stripe(config.stripe.secretKey);

    const file = await stripe.files.create({
      purpose: 'dispute_evidence',
      file: { data: pdfBuffer, name: `offer_terms_${params.offerId}.pdf`, type: 'application/pdf' },
    }, { stripeAccount: params.stripeUserId });

    await getSupabase()
      .from('offers_mirror')
      .update({ stripe_terms_file_id: file.id })
      .eq('id', params.offerId);

    await this.refreshEvidenceScoresForOffer(params.offerId);
    return file.id;
  },

  // #12: vault rows are keyed by Stripe customer id, but callers pass a GHL contact id. Translate
  // via payment_methods so the UPDATEs/RPC actually match rows (they were silently matching zero
  // and dropping merchant-uploaded evidence). Returns null when the contact has no Stripe customer.
  async resolveStripeCustomerId(merchantId: string, contactId: string): Promise<string | null> {
    const { data } = await getSupabase()
      .from('payment_methods')
      .select('stripe_customer_id')
      .eq('merchant_id', merchantId)
      .eq('contact_id', contactId)
      .not('stripe_customer_id', 'is', null)
      .limit(1)
      .maybeSingle();
    return (data as any)?.stripe_customer_id || null;
  },

  async uploadContractFile(params: {
    merchantId: string;
    stripeUserId: string;
    clientContactId: string;
    offerId: string;
    fileBuffer: Buffer;
    fileName: string;
  }): Promise<string | null> {
    if (!params.stripeUserId) return null;

    const stripeCustomerId = await this.resolveStripeCustomerId(params.merchantId, params.clientContactId);
    if (!stripeCustomerId) {
      logger.warn({ merchantId: params.merchantId, contactId: params.clientContactId }, 'Evidence vault: no Stripe customer for contact — contract not linked');
      return null;
    }

    const stripe = new Stripe(config.stripe.secretKey);
    const file = await stripe.files.create({
      purpose: 'dispute_evidence',
      file: { data: params.fileBuffer, name: params.fileName, type: 'application/pdf' },
    }, { stripeAccount: params.stripeUserId });

    const { data: updated, error } = await getSupabase()
      .from('stripe_evidence_vault')
      .update({ contract_signed: true, contract_file_id: file.id })
      .eq('merchant_id', params.merchantId)
      .eq('offer_id', params.offerId)
      .eq('stripe_customer_id', stripeCustomerId)
      .select('id');
    if (error) logger.error({ err: error.message, contactId: params.clientContactId }, 'Evidence vault: contract update failed');
    else if (!updated?.length) logger.warn({ merchantId: params.merchantId, offerId: params.offerId, stripeCustomerId }, 'Evidence vault: contract update matched 0 rows');

    await this.refreshEvidenceScoresForClient(params.merchantId, params.clientContactId);
    return file.id;
  },

  async uploadSessionLog(params: {
    merchantId: string;
    stripeUserId: string;
    clientContactId: string;
    offerId: string;
    sessionDate: string;
    sessionType: string;
    sessionNotes: string;
    durationMinutes?: number;
  }): Promise<string | null> {
    if (!params.stripeUserId) return null;

    const pdfBuffer = await this.generateSessionLogPdf(params);
    const stripe = new Stripe(config.stripe.secretKey);

    const file = await stripe.files.create({
      purpose: 'dispute_evidence',
      file: { data: pdfBuffer, name: `session_log_${params.sessionDate}.pdf`, type: 'application/pdf' },
    }, { stripeAccount: params.stripeUserId });

    const stripeCustomerId = await this.resolveStripeCustomerId(params.merchantId, params.clientContactId);
    if (!stripeCustomerId) {
      logger.warn({ merchantId: params.merchantId, contactId: params.clientContactId }, 'Evidence vault: no Stripe customer for contact — session log not linked');
      return null;
    }
    // Append to session_file_ids array (RPC matches on the Stripe customer id).
    await getSupabase().rpc('append_session_file_id', {
      p_merchant_id: params.merchantId,
      p_offer_id: params.offerId,
      p_customer_id: stripeCustomerId,
      p_file_id: file.id,
    });

    await this.refreshEvidenceScoresForClient(params.merchantId, params.clientContactId);
    return file.id;
  },

  async uploadCommunicationTrail(params: {
    merchantId: string;
    stripeUserId: string;
    clientContactId: string;
    offerId: string;
    communicationType: string;
    messages: Array<{ date: string; from: string; to: string; content: string }>;
  }): Promise<string | null> {
    if (!params.stripeUserId) return null;

    const pdfBuffer = await this.generateCommunicationPdf(params);
    const stripe = new Stripe(config.stripe.secretKey);

    const file = await stripe.files.create({
      purpose: 'dispute_evidence',
      file: { data: pdfBuffer, name: `communication_trail_${params.clientContactId}.pdf`, type: 'application/pdf' },
    }, { stripeAccount: params.stripeUserId });

    const stripeCustomerId = await this.resolveStripeCustomerId(params.merchantId, params.clientContactId);
    if (!stripeCustomerId) {
      logger.warn({ merchantId: params.merchantId, contactId: params.clientContactId }, 'Evidence vault: no Stripe customer for contact — communication trail not linked');
      return null;
    }
    const { data: updated, error } = await getSupabase()
      .from('stripe_evidence_vault')
      .update({ communication_file_id: file.id })
      .eq('merchant_id', params.merchantId)
      .eq('offer_id', params.offerId)
      .eq('stripe_customer_id', stripeCustomerId)
      .select('id');
    if (error) logger.error({ err: error.message, contactId: params.clientContactId }, 'Evidence vault: communication update failed');
    else if (!updated?.length) logger.warn({ merchantId: params.merchantId, offerId: params.offerId, stripeCustomerId }, 'Evidence vault: communication update matched 0 rows');

    await this.refreshEvidenceScoresForClient(params.merchantId, params.clientContactId);
    return file.id;
  },

  // ─── Evidence gaps + status ────────────────────────────

  async getVaultEntryForCharge(stripeChargeId: string): Promise<any | null> {
    const supabase = getSupabase();
    const { data } = await supabase
      .from('stripe_evidence_vault')
      .select('*')
      .eq('stripe_charge_id', stripeChargeId)
      .single();
    if (!data) return data;
    // #17: surface the offer's terms file id on the entry so getEvidenceGaps (which checks
    // entry.stripe_terms_file_id) doesn't always report "Offer terms not uploaded".
    if ((data as any).offer_id) {
      const { data: offer } = await supabase
        .from('offers_mirror')
        .select('stripe_terms_file_id')
        .eq('id', (data as any).offer_id)
        .maybeSingle();
      (data as any).stripe_terms_file_id = (offer as any)?.stripe_terms_file_id || null;
    }
    return data;
  },

  getEvidenceGaps(entry: any): string[] {
    if (!entry) return ['No evidence vault entry found for this transaction'];
    const gaps: string[] = [];
    if (!entry.terms_file_id && !entry.stripe_terms_file_id) gaps.push('Offer terms document not uploaded');
    if (!entry.contract_file_id) gaps.push('Signed contract not uploaded');
    if (!entry.session_file_ids?.length) gaps.push('No session/delivery logs uploaded');
    if (!entry.communication_file_id) gaps.push('No communication trail uploaded');
    if (!entry.ce30_fields_complete) gaps.push('CE 3.0 fields incomplete (missing IP, email, or description)');
    if (!entry.customer_billing_address) gaps.push('Customer billing address not captured');
    return gaps;
  },

  // ─── Score refresh ─────────────────────────────────────

  async refreshEvidenceScoresForOffer(offerId: string): Promise<void> {
    const supabase = getSupabase();
    const { data: offer } = await supabase
      .from('offers_mirror')
      .select('stripe_terms_file_id')
      .eq('id', offerId)
      .single();

    const { data: entries } = await supabase
      .from('stripe_evidence_vault')
      .select('*')
      .eq('offer_id', offerId);

    if (!entries) return;

    for (const entry of entries) {
      const newScore = this.computeEvidenceScore({
        hasTermsFile: !!(offer?.stripe_terms_file_id || entry.terms_file_id),
        hasContractFile: !!entry.contract_file_id,
        hasSessionLogs: entry.session_file_ids?.length > 0,
        hasCommunicationFile: !!entry.communication_file_id,
        metadataComplete: entry.ce30_fields_complete,
        hasBillingAddress: !!entry.customer_billing_address,
      });

      await supabase
        .from('stripe_evidence_vault')
        .update({ evidence_score: newScore })
        .eq('id', entry.id);
    }
  },

  async refreshEvidenceScoresForClient(merchantId: string, clientContactId: string): Promise<void> {
    const supabase = getSupabase();
    // #12: translate GHL contact id -> Stripe customer id (vault key).
    const stripeCustomerId = await this.resolveStripeCustomerId(merchantId, clientContactId);
    if (!stripeCustomerId) return;

    const { data: entries } = await supabase
      .from('stripe_evidence_vault')
      .select('*')
      .eq('merchant_id', merchantId)
      .eq('stripe_customer_id', stripeCustomerId);

    if (!entries) return;

    for (const entry of entries) {
      // #17: offer terms live on offers_mirror.stripe_terms_file_id, never on the vault row, so
      // the client refresh must join the offer (like refreshEvidenceScoresForOffer) — otherwise
      // the score is ~20pts lower and differs depending on which refresh ran last.
      let offerTermsFileId: string | null = null;
      if (entry.offer_id) {
        const { data: offer } = await supabase
          .from('offers_mirror')
          .select('stripe_terms_file_id')
          .eq('id', entry.offer_id)
          .maybeSingle();
        offerTermsFileId = (offer as any)?.stripe_terms_file_id || null;
      }
      const newScore = this.computeEvidenceScore({
        hasTermsFile: !!(entry.terms_file_id || offerTermsFileId),
        hasContractFile: !!entry.contract_file_id,
        hasSessionLogs: entry.session_file_ids?.length > 0,
        hasCommunicationFile: !!entry.communication_file_id,
        metadataComplete: entry.ce30_fields_complete,
        hasBillingAddress: !!entry.customer_billing_address,
      });

      await supabase
        .from('stripe_evidence_vault')
        .update({ evidence_score: newScore })
        .eq('id', entry.id);
    }
  },

  // ─── PDF generation ────────────────────────────────────

  async generateOfferTermsPdf(params: {
    offerTitle: string;
    offerDescription: string;
    refundPolicy: string;
    tcClauses: string[];
    pricing: { type: string; amount: number; installments?: number };
  }): Promise<Buffer> {
    const doc = await PDFDocument.create();
    const page = doc.addPage();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);
    const pageW = page.getWidth();
    let y = page.getHeight() - 50;

    page.drawText(params.offerTitle || 'Offer Terms', { x: 50, y, font: bold, size: 18 });
    y -= 30;

    if (params.offerDescription) {
      page.drawText('Program Description:', { x: 50, y, font: bold, size: 12 });
      y -= 16;
      for (const line of wrapText(params.offerDescription, 80)) {
        page.drawText(line, { x: 50, y, font, size: 10 });
        y -= 14;
      }
      y -= 10;
    }

    page.drawText('Pricing:', { x: 50, y, font: bold, size: 12 });
    y -= 16;
    const priceText = params.pricing.type === 'one_time' || params.pricing.type === 'pif'
      ? `Paid in Full: $${(params.pricing.amount / 100).toFixed(2)}`
      : `${params.pricing.installments || '?'} payments of $${(params.pricing.amount / 100).toFixed(2)}`;
    page.drawText(priceText, { x: 50, y, font, size: 10 });
    y -= 24;

    if (params.refundPolicy) {
      page.drawText('Refund Policy:', { x: 50, y, font: bold, size: 12 });
      y -= 16;
      for (const line of wrapText(params.refundPolicy, 80)) {
        page.drawText(line, { x: 50, y, font, size: 10 });
        y -= 14;
      }
      y -= 10;
    }

    if (params.tcClauses.length > 0) {
      page.drawText('Terms & Conditions:', { x: 50, y, font: bold, size: 12 });
      y -= 16;
      for (const clause of params.tcClauses) {
        for (const line of wrapText(`• ${clause}`, 78)) {
          page.drawText(line, { x: 60, y, font, size: 10 });
          y -= 14;
        }
      }
    }

    y -= 20;
    page.drawText(`Generated by ScaleSafe on ${new Date().toISOString().split('T')[0]}`, {
      x: 50, y, font, size: 8, color: rgb(0.5, 0.5, 0.5),
    });

    return Buffer.from(await doc.save());
  },

  async generateSessionLogPdf(params: {
    sessionDate: string;
    sessionType: string;
    sessionNotes: string;
    durationMinutes?: number;
  }): Promise<Buffer> {
    const doc = await PDFDocument.create();
    const page = doc.addPage();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);
    let y = page.getHeight() - 50;

    page.drawText('Session/Delivery Log', { x: 50, y, font: bold, size: 18 });
    y -= 30;

    page.drawText(`Date: ${params.sessionDate}`, { x: 50, y, font, size: 11 });
    y -= 18;
    page.drawText(`Type: ${params.sessionType}`, { x: 50, y, font, size: 11 });
    y -= 18;
    if (params.durationMinutes) {
      page.drawText(`Duration: ${params.durationMinutes} minutes`, { x: 50, y, font, size: 11 });
      y -= 18;
    }
    y -= 10;

    page.drawText('Notes:', { x: 50, y, font: bold, size: 12 });
    y -= 16;
    for (const line of wrapText(params.sessionNotes, 80)) {
      page.drawText(line, { x: 50, y, font, size: 10 });
      y -= 14;
    }

    y -= 20;
    page.drawText(`Generated by ScaleSafe on ${new Date().toISOString().split('T')[0]}`, {
      x: 50, y, font, size: 8, color: rgb(0.5, 0.5, 0.5),
    });

    return Buffer.from(await doc.save());
  },

  async generateCommunicationPdf(params: {
    communicationType: string;
    messages: Array<{ date: string; from: string; to: string; content: string }>;
  }): Promise<Buffer> {
    const doc = await PDFDocument.create();
    const page = doc.addPage();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);
    let y = page.getHeight() - 50;

    page.drawText(`Communication Trail (${params.communicationType})`, { x: 50, y, font: bold, size: 18 });
    y -= 30;

    for (const msg of params.messages) {
      page.drawText(`${msg.date} - ${msg.from} to ${msg.to}`, { x: 50, y, font: bold, size: 10 });
      y -= 14;
      for (const line of wrapText(msg.content, 80)) {
        page.drawText(line, { x: 60, y, font, size: 9 });
        y -= 12;
      }
      y -= 8;
      if (y < 60) break; // Avoid overflowing the page
    }

    y -= 10;
    page.drawText(`Generated by ScaleSafe on ${new Date().toISOString().split('T')[0]}`, {
      x: 50, y: Math.max(y, 30), font, size: 8, color: rgb(0.5, 0.5, 0.5),
    });

    return Buffer.from(await doc.save());
  },
};
