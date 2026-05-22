import { callClaude } from '../clients/anthropic.client';
import { ghlApi } from '../clients/ghl.client';
import { getSupabase } from '../clients/supabase.client';
import { defenseRepository } from '../repositories/defense.repository';
import { evidenceRepository } from '../repositories/evidence.repository';
import { merchantRepository } from '../repositories/merchant.repository';
import { paymentService } from './payment.service';
import { triggerService } from './trigger.service';
import { storageService } from './storage.service';
import { defenseExhibitsService, type ExhibitList, type ExhibitEntry } from './defense-exhibits.service';
import { logger } from '../utils/logger';
import { SS_CONTACT_FIELDS, WORKFLOW_DEFENSE_CONTACT_FIELDS } from '../constants/ghl-fields';

/**
 * Reason code → category mapping.
 * From SCALESAFE_APP_BLUEPRINT_v2.1 Section 10.
 */
const REASON_CODE_CATEGORIES: Record<string, string> = {
  // Visa
  '10.1': 'authorization',
  '10.4': 'fraud',
  '13.1': 'services_not_provided',
  '13.3': 'not_as_described',
  '13.6': 'credit_not_processed',
  // Mastercard
  '4837': 'fraud',
  '4853': 'not_as_described',
  '4855': 'services_not_provided',
  '4860': 'credit_not_processed',
  // Amex
  'C08': 'services_not_provided',
  'C31': 'not_as_described',
  'FR2': 'fraud',
  'FR6': 'fraud',
};

interface CompileDefenseInput {
  locationId: string;
  contactId: string;
  offerId?: string;
  reasonCode: string;
  disputeAmount: number;
  disputeDate: string;
  deadline: string;
  caseNumber?: string;
  /** Per-defense addressee (e.g., "Stripe Disputes Team"). Defaulted by processor when omitted. */
  addressee?: string;
  /** Stripe-rail: link an existing dispute_events row. NMI-rail: omit and let compileDefense create one. */
  disputeEventId?: string;
  /** 'stripe' | 'nmi' — required when creating a new dispute_event server-side. */
  processor?: 'stripe' | 'nmi';
  /** The specific payment_event being disputed (from the transaction selector). */
  paymentEventId?: string;
  /** The enrollment tied to the disputed transaction (resolved from payment_event). */
  enrollmentId?: string;
}

/**
 * Map a raw defense_packets row (with the actual schema column names) into the
 * response shape the frontend reads. Keeps DefenseDetailView.vue stable without
 * forcing it to learn the new column names.
 */
function shapePacketResponse(packet: any): any {
  if (!packet) return packet;
  return {
    ...packet,
    // Aliases for legacy field names the frontend reads
    reason_code: packet.chargeback_reason_code,
    reason_category: packet.reason_code_category,
    dispute_amount: packet.chargeback_amount,
    dispute_date: packet.chargeback_date,
    deadline: packet.response_deadline,
    input_tokens: packet.prompt_tokens_used,
    output_tokens: packet.response_tokens_used,
    // New lifecycle fields (migration 044)
    lifecycleStatus: packet.lifecycle_status || 'pending_submission',
    submittedAt: packet.submitted_at || null,
    disputeEventId: packet.dispute_event_id || null,
    addressee: packet.addressee || null,
  };
}

async function shapePacketResponseWithFreshUrl(packet: any): Promise<any> {
  const shaped = shapePacketResponse(packet);
  if (!shaped?.pdf_storage_path) return shaped;

  try {
    shaped.pdf_url = await storageService.createPrivateSignedUrl(shaped.pdf_storage_path);
  } catch (err: any) {
    logger.warn({ err: err.message, defenseId: shaped.id }, 'Failed to refresh defense packet signed URL');
  }

  return shaped;
}

export const defenseService = {
  /**
   * Trigger defense compilation. Returns defenseId immediately.
   * Compilation runs asynchronously in the background.
   */
  async compileDefense(input: CompileDefenseInput): Promise<string> {
    const category = REASON_CODE_CATEGORIES[input.reasonCode] || 'services_not_provided';
    const supabase = getSupabase();

    // Resolve dispute_event_id. Stripe path: use the provided id. NMI path:
    // create the dispute_events row server-side first so the FK is always
    // populated and the chargeback ratio job has a single source of truth.
    let disputeEventId = input.disputeEventId || null;
    const processor: 'stripe' | 'nmi' = input.processor || (disputeEventId ? 'stripe' : 'nmi');

    if (!disputeEventId && processor === 'nmi') {
      try {
        const merchant = await merchantRepository.getByLocationId(input.locationId);
        const { data: created, error: createErr } = await supabase
          .from('dispute_events')
          .insert({
            merchant_id: merchant.id,
            location_id: input.locationId,
            contact_id: input.contactId,
            stripe_dispute_id: null, // NMI rows have no Stripe ID — column was relaxed in migration 044
            processor: 'nmi',
            reason: input.reasonCode,
            status: 'needs_response',
            amount: input.disputeAmount,
            currency: 'usd',
            evidence_due_by: input.deadline,
          })
          .select('id')
          .single();
        if (createErr) throw createErr;
        disputeEventId = created?.id || null;
        logger.info({ disputeEventId, locationId: input.locationId }, 'NMI dispute_event row created server-side');
      } catch (err: any) {
        logger.warn({ err: err.message, locationId: input.locationId }, 'Failed to create NMI dispute_event row — defense will still compile but ratio loop is broken for this packet');
      }
    }

    // Resolve addressee — default per processor if merchant didn't override
    const addressee = input.addressee
      || (processor === 'stripe' ? 'Stripe Disputes Team' : 'Sponsor Bank — Chargeback Department');

    // Create pending defense packet (column names match migration 002 + 043 + 044)
    const packet = await defenseRepository.create({
      location_id: input.locationId,
      contact_id: input.contactId,
      offer_id: input.offerId,
      chargeback_reason_code: input.reasonCode,
      reason_code_category: category,
      chargeback_amount: input.disputeAmount,
      chargeback_date: input.disputeDate,
      response_deadline: input.deadline,
      case_number: input.caseNumber,
      lifecycle_status: 'pending_submission',
      dispute_event_id: disputeEventId,
      addressee,
      payment_event_id: input.paymentEventId || null,
      enrollment_id: input.enrollmentId || null,
    } as any);

    // Update GHL contact before firing the workflow trigger so templates can
    // safely use either trigger payload variables or contact-field fallbacks.
    try {
      const api = await ghlApi(input.locationId);
      await api.put(`/contacts/${input.contactId}`, {
        customField: {
          [SS_CONTACT_FIELDS.CHARGEBACK_STATUS]: 'disputed',
          [SS_CONTACT_FIELDS.DEFENSE_STATUS]: 'preparing',
          [WORKFLOW_DEFENSE_CONTACT_FIELDS.CHARGEBACK_REASON_CODE]: input.reasonCode,
        },
      });
    } catch (err) {
      logger.warn({ err, contactId: input.contactId }, 'Failed to update chargeback status');
    }

    // Fire chargeback detected workflow through the Marketplace trigger path.
    await triggerService.fireTrigger(input.locationId, 'ss_chargeback_detected', {
      event_type: 'chargeback_detected',
      location_id: input.locationId,
      locationId: input.locationId,
      contact_id: input.contactId,
      contactId: input.contactId,
      offer_id: input.offerId || '',
      offerId: input.offerId || '',
      amount: input.disputeAmount,
      reason_code: input.reasonCode,
      reasonCode: input.reasonCode,
      dispute_date: input.disputeDate,
      disputeDate: input.disputeDate,
      processor,
      defense_id: packet.id,
      defenseId: packet.id,
    }).catch((trigErr: any) => {
      logger.warn({ err: trigErr.message, defenseId: packet.id }, 'Chargeback detected trigger fire failed (non-fatal)');
    });

    // Run compilation async
    this.runCompilation(packet.id, input, category).catch((err) => {
      logger.error({ err, defenseId: packet.id }, 'Defense compilation failed');
      defenseRepository.updateStatus(packet.id, 'failed', {
        defense_letter_text: `Compilation failed: ${err.message}`,
      });
    });

    logger.info({ defenseId: packet.id, reasonCode: input.reasonCode, category }, 'Defense compilation triggered');
    return packet.id;
  },

  /**
   * Run the full defense compilation pipeline.
   */
  async runCompilation(defenseId: string, input: CompileDefenseInput, category: string): Promise<void> {
    await defenseRepository.updateStatus(defenseId, 'processing');
    const supabase = getSupabase();

    // 1. Build the single-source-of-truth exhibit list (used by BOTH the prompt AND the PDF bundler)
    // When an enrollmentId is available (from the transaction selector), scope exhibits to that enrollment.
    const exhibitList = await defenseExhibitsService.buildExhibitList(input.locationId, input.contactId, {
      enrollmentId: input.enrollmentId,
    });

    // 2. Also gather raw evidence snapshot for the packet row (legacy column, still useful for debug)
    const evidence = await evidenceRepository.getFullSnapshot(input.locationId, input.contactId);
    await defenseRepository.updateStatus(defenseId, 'processing', {
      evidence_snapshot: evidence,
      evidence_count: exhibitList.exhibits.length,
    } as any);

    // 3. Get undisputed payments (critical for defense — Prior Undisputed Transactions section)
    const undisputedPayments = await paymentService.getUndisputedPayments(input.locationId, input.contactId);

    // 4. Get contact details from GHL
    let contactDetails: Record<string, unknown> = {};
    try {
      const api = await ghlApi(input.locationId);
      const contactRes = await api.get(`/contacts/${input.contactId}`);
      contactDetails = contactRes.data.contact || contactRes.data;
    } catch (err) {
      logger.warn({ err, contactId: input.contactId }, 'Failed to fetch contact details');
    }

    // 5. Get merchant info
    const merchant = await merchantRepository.getByLocationId(input.locationId);

    // 6. Look up reason code strategy + defense template
    const strategy = await defenseRepository.getReasonCodeStrategy(input.reasonCode);
    const template = await defenseRepository.getDefenseTemplate(category);

    // 7. Build the AI prompt with the rewritten clinical-tone structure
    const systemPrompt = this.buildSystemPrompt(category, strategy, template);
    const userMessage = this.buildUserMessage(
      input, contactDetails, merchant, exhibitList, undisputedPayments, category,
    );

    // 8. Call Claude API
    const result = await callClaude(systemPrompt, userMessage, 8192);

    // 9. Write the letter to defense_letter_versions as version 1 and mirror to the fast-read column
    try {
      await supabase.from('defense_letter_versions').insert({
        defense_packet_id: defenseId,
        version_number: 1,
        letter_text: result.text,
        generated_by: 'ai',
        model_used: 'claude',
        prompt_tokens_used: result.inputTokens,
        response_tokens_used: result.outputTokens,
      });
    } catch (vErr: any) {
      logger.warn({ err: vErr.message, defenseId }, 'Failed to insert letter version row (non-fatal — letter still saved on packet)');
    }

    await defenseRepository.updateStatus(defenseId, 'complete', {
      defense_letter_text: result.text,
      prompt_tokens_used: result.inputTokens,
      response_tokens_used: result.outputTokens,
      template_id: template?.id || null,
      completed_at: new Date().toISOString(),
    });

    // 10. Generate bundled PDF (fire-and-forget — don't block the status update)
    let defensePacketUrl = '';
    try {
      const { defenseBundleService } = require('./defense-bundle.service');
      defensePacketUrl = await defenseBundleService.bundleDefensePdf(defenseId, input.locationId, input.contactId, {
        enrollmentId: input.enrollmentId,
      });
    } catch (pdfErr: any) {
      logger.warn({ err: pdfErr.message, defenseId }, 'Bundled PDF generation failed (non-fatal — letter text is available inline)');
    }

    // 11. Update GHL contact
    try {
      const api = await ghlApi(input.locationId);
      await api.put(`/contacts/${input.contactId}`, {
        customField: {
          [SS_CONTACT_FIELDS.DEFENSE_STATUS]: 'ready',
          [WORKFLOW_DEFENSE_CONTACT_FIELDS.DEFENSE_PACKET_URL]: defensePacketUrl,
          [WORKFLOW_DEFENSE_CONTACT_FIELDS.DEFENSE_PDF_URL]: defensePacketUrl,
        },
      });
    } catch (err) {
      logger.warn({ err }, 'Failed to update defense status on contact');
    }

    // 12. Fire defense ready notification
    let readinessScore = 0;
    try {
      const { evidenceService } = require('./evidence.service');
      const scoreResult = await evidenceService.calculateReadinessScore(input.locationId, input.contactId);
      readinessScore = scoreResult.score;
    } catch {}

    try {
      await triggerService.fireTrigger(input.locationId, 'ss_defense_ready', {
        event_type: 'defense_ready',
        location_id: input.locationId,
        locationId: input.locationId,
        contact_id: input.contactId,
        contactId: input.contactId,
        offer_id: input.offerId || '',
        offerId: input.offerId || '',
        defense_id: defenseId,
        defenseId,
        packet_url: defensePacketUrl,
        packetUrl: defensePacketUrl,
        defense_pdf_url: defensePacketUrl,
        defensePdfUrl: defensePacketUrl,
        evidence_count: exhibitList.exhibits.length,
        evidenceCount: exhibitList.exhibits.length,
        readiness_score: readinessScore,
        readinessScore,
        processor: input.processor || 'stripe',
      });
    } catch (trigErr: any) {
      logger.warn({ err: trigErr.message, defenseId }, 'Defense ready trigger fire failed (non-fatal)');
    }

    logger.info({
      defenseId,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      exhibitCount: exhibitList.exhibits.length,
    }, 'Defense compilation complete');
  },

  buildSystemPrompt(category: string, strategy: any, template: any): string {
    const categoryStrategies: Record<string, string> = {
      fraud: 'The cardholder claims they did not authorize this transaction. Link the enrollment consent record (IP, device fingerprint, digital signature) to the transaction. Show that the same person who enrolled also used the service. Reference the signed enrollment packet as the primary exhibit.',
      services_not_provided: 'The cardholder claims services were not provided. Itemize every delivered touchpoint with specific dates: session records, module completions, milestone sign-offs, platform access logs. Cite each as a numbered exhibit.',
      not_as_described: 'The cardholder claims the service was not as described. Compare the offer terms presented at enrollment (from the signed enrollment packet) against what was actually delivered. Show the client reviewed and agreed to terms before purchasing.',
      credit_not_processed: 'The cardholder claims a credit/refund was promised but not received. Present the refund policy from the enrollment terms, communication logs showing what was communicated about refunds, and any refund actions that were taken.',
      authorization: 'The cardholder disputes authorization. Focus on consent proof: the signed enrollment packet with T&C acceptance timestamp, IP address, device fingerprint, scroll depth, and digital signature. This is the strongest evidence for authorization disputes.',
    };

    let prompt = `You are generating a chargeback defense letter. Your output will be submitted to a payment processor or bank as part of a formal dispute response.

TONE AND STYLE:
- Use a clinical, factual tone throughout. State facts, dates, and amounts. Let the evidence speak for itself.
- Do NOT use argumentative, persuasive, or emotional language.
- Do NOT use phrases like "we strongly contest," "the cardholder is mistaken," "we believe," or "it is clear that."
- Do NOT write "Dear Issuing Bank" or "[CASE NUMBER]" or "[Current Date]" or any bracketed placeholder. All values must come from the data provided below — if a value is missing, write "information not provided" in plain text, never leave an unfilled bracket.
- Write in third person ("The merchant provided...", "The client enrolled...").

DISPUTE CATEGORY: ${category.replace(/_/g, ' ')}

STRATEGY: ${categoryStrategies[category] || 'Present all available evidence of service delivery and client engagement.'}

CRITICAL RULES FOR EVENT INTERPRETATION:
- Cancellation events are TERMINATION events. State the cancellation date and reason factually. Do NOT characterize cancellations as evidence of ongoing service delivery or engagement. The active service period ended on the cancellation date.
- Refund events are financial resolution events. State whether a refund was issued, the amount, and the date. Do not editorialize on whether the refund was "fair."
- Subscription changes (pause/resume) are lifecycle events. Pauses mean service was temporarily suspended. Resumes mean it restarted. State dates and reasons only.
- Session no-shows are NOT evidence of service delivery. They are evidence that the client was offered a session and did not attend.
- Only sessions with attendance_status = "attended" should be cited as evidence of service delivery.

EXHIBIT REFERENCES:
- The evidence below is organized by numbered exhibit (Exhibit A, Exhibit B, etc.).
- When citing a fact in the letter, reference the exhibit inline: "(Exhibit A)" or "(see Exhibit C)".
- Every factual claim about service delivery MUST cite an exhibit. Do not cite exhibits that are not in the provided list.
- Do not invent or fabricate evidence. If the provided exhibits don't support a claim, do not make the claim.

LETTER STRUCTURE:
1. Header with date, addressee, case reference, and merchant name
2. Brief dispute summary (1-2 sentences stating the dispute facts)
3. Evidence of authorization / enrollment (cite consent exhibits)
4. Evidence of service delivery (cite delivery exhibits)
5. Prior Undisputed Transactions section
6. Conclusion (factual summary, not argumentative)
7. Exhibit index (numbered list of all cited exhibits)
`;

    if (strategy?.evidence_priorities) {
      prompt += `\nEVIDENCE PRIORITIES FOR REASON CODE ${strategy.reason_code}:\n${JSON.stringify(strategy.evidence_priorities, null, 2)}\n`;
    }

    if (template?.template_text) {
      prompt += `\nTEMPLATE STRUCTURE (use this as a structural guide, not a verbatim template):\n${template.template_text}\n`;
    }

    return prompt;
  },

  buildUserMessage(
    input: CompileDefenseInput,
    contact: Record<string, unknown>,
    merchant: any,
    exhibitList: ExhibitList,
    undisputedPayments: any[],
    category: string,
  ): string {
    const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    const clientName = [contact.firstName || '', contact.lastName || ''].filter(Boolean).join(' ') || 'Client';
    const clientEmail = (contact.email as string) || 'not on file';
    const addressee = input.addressee || 'Dispute Resolution Department';

    let msg = `TODAY'S DATE: ${today}\n\n`;
    msg += `ADDRESSEE: ${addressee}\n\n`;

    msg += `DISPUTE DETAILS:\n`;
    msg += `- Case/ARN Number: ${input.caseNumber || 'information not provided'}\n`;
    msg += `- Reason Code: ${input.reasonCode}\n`;
    msg += `- Disputed Amount: $${Number(input.disputeAmount).toFixed(2)}\n`;
    msg += `- Dispute Date: ${input.disputeDate}\n`;
    msg += `- Response Deadline: ${input.deadline}\n\n`;

    msg += `MERCHANT:\n`;
    msg += `- Business Name: ${merchant.business_name || 'N/A'}\n`;
    msg += `- Support Email: ${merchant.support_email || 'N/A'}\n\n`;

    msg += `CLIENT:\n`;
    msg += `- Name: ${clientName}\n`;
    msg += `- Email: ${clientEmail}\n\n`;

    // ── Exhibits by category (pre-grouped, pre-summarized, server-rendered) ──

    // 1. Consent exhibits
    if (exhibitList.byCategory.consent.length > 0) {
      msg += `═══ CONSENT EVIDENCE (${exhibitList.byCategory.consent.length} exhibits) ═══\n`;
      for (const ex of exhibitList.byCategory.consent) {
        msg += `  Exhibit ${ex.letter}: ${ex.name}\n    ${ex.summary}\n\n`;
      }
    }

    // 2. Service delivery exhibits
    if (exhibitList.byCategory.service_delivery.length > 0) {
      msg += `═══ SERVICE DELIVERY EVIDENCE (${exhibitList.byCategory.service_delivery.length} exhibits) ═══\n`;
      for (const ex of exhibitList.byCategory.service_delivery) {
        msg += `  Exhibit ${ex.letter}: ${ex.name}\n    ${ex.summary}\n\n`;
      }
    }

    // 3. Communication exhibits
    if (exhibitList.byCategory.communication.length > 0) {
      msg += `═══ COMMUNICATION EVIDENCE (${exhibitList.byCategory.communication.length} exhibits) ═══\n`;
      for (const ex of exhibitList.byCategory.communication) {
        msg += `  Exhibit ${ex.letter}: ${ex.name}\n    ${ex.summary}\n\n`;
      }
    }

    // 4. Payment exhibits
    if (exhibitList.byCategory.payments.length > 0) {
      msg += `═══ PAYMENT EVIDENCE (${exhibitList.byCategory.payments.length} exhibits) ═══\n`;
      for (const ex of exhibitList.byCategory.payments) {
        msg += `  Exhibit ${ex.letter}: ${ex.name}\n    ${ex.summary}\n\n`;
      }
    }

    // 5. Termination events (cancellation, refund, subscription changes) — SEPARATE section
    if (exhibitList.byCategory.termination.length > 0) {
      msg += `═══ TERMINATION EVENTS (${exhibitList.byCategory.termination.length} exhibits — these are NOT service delivery) ═══\n`;
      for (const ex of exhibitList.byCategory.termination) {
        msg += `  Exhibit ${ex.letter}: ${ex.name}\n    ${ex.summary}\n\n`;
      }
    }

    // 6. Prior Undisputed Transactions (always include when available)
    msg += `═══ PRIOR UNDISPUTED TRANSACTIONS (${undisputedPayments.length}) ═══\n`;
    if (undisputedPayments.length === 0) {
      msg += `  No prior undisputed transactions on record.\n\n`;
    } else {
      for (const p of undisputedPayments) {
        msg += `  - ${p.payment_date || p.created_at}: $${Number(p.amount || 0).toFixed(2)}\n`;
      }
      msg += `\n`;
    }

    msg += `Generate the defense letter now. Use the exact exhibit letters (A, B, C…) provided above. Do not add or skip any.`;
    return msg;
  },

  async getStatus(defenseId: string, locationId?: string) {
    const packet = await defenseRepository.getById(defenseId, locationId);
    return {
      id: packet.id,
      status: packet.status,
      lifecycleStatus: (packet as any).lifecycle_status || 'pending_submission',
      reasonCode: packet.chargeback_reason_code,
      category: packet.reason_code_category,
      createdAt: packet.created_at,
      hasLetter: !!packet.defense_letter_text,
      hasPdf: !!packet.pdf_url,
    };
  },

  async getPacket(defenseId: string, locationId?: string) {
    const packet = await defenseRepository.getById(defenseId, locationId);
    return shapePacketResponseWithFreshUrl(packet);
  },

  async listForContact(locationId: string, contactId: string) {
    const packets = await defenseRepository.listByContact(locationId, contactId);
    return Promise.all(packets.map(shapePacketResponseWithFreshUrl));
  },

  async recordOutcome(defenseId: string, outcome: 'won' | 'lost' | 'withdrawn', opts?: {
    amountRecovered?: number;
    resolvedAt?: string;
    notes?: string;
    locationId?: string;
  }) {
    const packet = await defenseRepository.getById(defenseId, opts?.locationId);
    const supabase = getSupabase();

    // 1. Write defense_outcomes row
    const amountRecovered = outcome === 'won' ? (opts?.amountRecovered ?? packet.chargeback_amount ?? 0) : 0;
    await defenseRepository.recordOutcome(defenseId, packet.location_id, outcome, amountRecovered, opts?.notes);

    // 2. Update lifecycle_status on the packet
    await supabase.from('defense_packets')
      .update({
        lifecycle_status: outcome,
      })
      .eq('id', defenseId);

    // 3. Propagate to linked dispute_events (if FK populated)
    const disputeEventId = (packet as any).dispute_event_id;
    if (disputeEventId) {
      try {
        const statusMap: Record<string, string> = {
          won: 'won',
          lost: 'lost',
          withdrawn: 'warning_closed',
        };
        await supabase.from('dispute_events')
          .update({
            outcome,
            outcome_at: opts?.resolvedAt || new Date().toISOString(),
            status: statusMap[outcome] || outcome,
            net_financial_impact: outcome === 'won' ? amountRecovered : -(packet.chargeback_amount || 0),
          })
          .eq('id', disputeEventId);
      } catch (err: any) {
        logger.warn({ err: err.message, defenseId, disputeEventId }, 'Failed to propagate outcome to dispute_events');
      }
    }

    // 4. Update GHL contact chargeback status
    try {
      const api = await ghlApi(packet.location_id);
      await api.put(`/contacts/${packet.contact_id}`, {
        customField: {
          [SS_CONTACT_FIELDS.CHARGEBACK_STATUS]: outcome,
        },
      });
    } catch (err) {
      logger.warn({ err, defenseId }, 'Failed to update chargeback outcome on contact');
    }

    logger.info({ defenseId, outcome, amountRecovered, disputeEventId }, 'Defense outcome recorded');
  },

  /**
   * Mark a defense packet as submitted. Locks the letter + PDF.
   */
  async markSubmitted(defenseId: string, locationId?: string): Promise<void> {
    const supabase = getSupabase();
    const packet = await defenseRepository.getById(defenseId, locationId);

    if ((packet as any).lifecycle_status !== 'pending_submission') {
      throw new Error(`Cannot submit a packet with status '${(packet as any).lifecycle_status}'`);
    }

    // Lock the current letter version
    try {
      await supabase.from('defense_letter_versions')
        .update({ is_submitted_version: true })
        .eq('defense_packet_id', defenseId)
        .order('version_number', { ascending: false })
        .limit(1);
    } catch {}

    await supabase.from('defense_packets')
      .update({
        lifecycle_status: 'submitted',
        submitted_at: new Date().toISOString(),
      })
      .eq('id', defenseId);

    // Update linked dispute_events status
    const disputeEventId = (packet as any).dispute_event_id;
    if (disputeEventId) {
      try {
        await supabase.from('dispute_events')
          .update({ status: 'under_review', evidence_submitted: true, evidence_submitted_at: new Date().toISOString() })
          .eq('id', disputeEventId);
      } catch {}
    }

    logger.info({ defenseId }, 'Defense packet marked as submitted');
  },

  /**
   * Regenerate the AI letter for a packet. Inserts a new version, mirrors to fast-read column.
   * Only available before submission.
   */
  async regenerateLetter(defenseId: string, locationId?: string): Promise<{ letterText: string; versionNumber: number }> {
    const supabase = getSupabase();
    const packet = await defenseRepository.getById(defenseId, locationId);

    if ((packet as any).lifecycle_status === 'submitted' || (packet as any).lifecycle_status === 'won' || (packet as any).lifecycle_status === 'lost') {
      throw new Error('Cannot regenerate a letter after submission');
    }

    // Get max version number
    const { data: maxRow } = await supabase
      .from('defense_letter_versions')
      .select('version_number')
      .eq('defense_packet_id', defenseId)
      .order('version_number', { ascending: false })
      .limit(1)
      .maybeSingle();
    const nextVersion = (maxRow?.version_number || 0) + 1;

    // Re-run compilation input from the packet
    const category = packet.reason_code_category || 'services_not_provided';
    const input: CompileDefenseInput = {
      locationId: packet.location_id,
      contactId: packet.contact_id,
      enrollmentId: packet.enrollment_id || undefined,
      reasonCode: packet.chargeback_reason_code || '',
      disputeAmount: packet.chargeback_amount || 0,
      disputeDate: packet.chargeback_date || '',
      deadline: packet.response_deadline || '',
      caseNumber: packet.case_number || '',
      addressee: (packet as any).addressee || '',
    };

    const exhibitList = await defenseExhibitsService.buildExhibitList(input.locationId, input.contactId, {
      enrollmentId: input.enrollmentId,
    });
    const undisputedPayments = await paymentService.getUndisputedPayments(input.locationId, input.contactId);
    let contactDetails: Record<string, unknown> = {};
    try {
      const api = await ghlApi(input.locationId);
      const contactRes = await api.get(`/contacts/${input.contactId}`);
      contactDetails = contactRes.data.contact || contactRes.data;
    } catch {}
    const merchant = await merchantRepository.getByLocationId(input.locationId);
    const strategy = await defenseRepository.getReasonCodeStrategy(input.reasonCode);
    const template = await defenseRepository.getDefenseTemplate(category);

    const systemPrompt = this.buildSystemPrompt(category, strategy, template);
    const userMessage = this.buildUserMessage(input, contactDetails, merchant, exhibitList, undisputedPayments, category);
    const result = await callClaude(systemPrompt, userMessage, 8192);

    // Insert new version
    await supabase.from('defense_letter_versions').insert({
      defense_packet_id: defenseId,
      version_number: nextVersion,
      letter_text: result.text,
      generated_by: 'ai',
      model_used: 'claude',
      prompt_tokens_used: result.inputTokens,
      response_tokens_used: result.outputTokens,
    });

    // Mirror to fast-read column
    await defenseRepository.updateStatus(defenseId, packet.status, {
      defense_letter_text: result.text,
      prompt_tokens_used: result.inputTokens,
      response_tokens_used: result.outputTokens,
    });

    // Rebundle PDF
    try {
      const { defenseBundleService } = require('./defense-bundle.service');
      await defenseBundleService.bundleDefensePdf(defenseId, input.locationId, input.contactId, {
        enrollmentId: input.enrollmentId,
      });
    } catch {}

    logger.info({ defenseId, version: nextVersion }, 'Defense letter regenerated');
    return { letterText: result.text, versionNumber: nextVersion };
  },

  /**
   * Save a manual letter edit. Creates a new version.
   * Only available before submission.
   */
  async saveLetterEdit(defenseId: string, letterText: string, locationId?: string): Promise<{ versionNumber: number }> {
    const supabase = getSupabase();
    const packet = await defenseRepository.getById(defenseId, locationId);

    if ((packet as any).lifecycle_status === 'submitted' || (packet as any).lifecycle_status === 'won' || (packet as any).lifecycle_status === 'lost') {
      throw new Error('Cannot edit a letter after submission');
    }

    const { data: maxRow } = await supabase
      .from('defense_letter_versions')
      .select('version_number')
      .eq('defense_packet_id', defenseId)
      .order('version_number', { ascending: false })
      .limit(1)
      .maybeSingle();
    const nextVersion = (maxRow?.version_number || 0) + 1;

    await supabase.from('defense_letter_versions').insert({
      defense_packet_id: defenseId,
      version_number: nextVersion,
      letter_text: letterText,
      generated_by: 'manual_edit',
    });

    // Mirror to fast-read column
    await supabase.from('defense_packets')
      .update({ defense_letter_text: letterText })
      .eq('id', defenseId);

    // Rebundle PDF
    try {
      const { defenseBundleService } = require('./defense-bundle.service');
      await defenseBundleService.bundleDefensePdf(defenseId, packet.location_id, packet.contact_id, {
        enrollmentId: packet.enrollment_id || undefined,
      });
    } catch {}

    logger.info({ defenseId, version: nextVersion }, 'Defense letter edited (manual)');
    return { versionNumber: nextVersion };
  },

  /**
   * Get letter version history for a packet.
   */
  async getLetterVersions(defenseId: string, locationId?: string): Promise<any[]> {
    await defenseRepository.getById(defenseId, locationId);
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('defense_letter_versions')
      .select('*')
      .eq('defense_packet_id', defenseId)
      .order('version_number', { ascending: false });
    if (error) throw error;
    return data || [];
  },
};
