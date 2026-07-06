import { callClaude } from '../clients/anthropic.client';
import { ghlApi } from '../clients/ghl.client';
import { getSupabase } from '../clients/supabase.client';
import { defenseRepository } from '../repositories/defense.repository';
import { evidenceRepository } from '../repositories/evidence.repository';
import { merchantRepository } from '../repositories/merchant.repository';
import { paymentService } from './payment.service';
import { triggerService } from './trigger.service';
import { storageService } from './storage.service';
import { defenseExhibitsService, normalizeEvidencePriorities, buildTimelineRows, type ExhibitList, type ExhibitEntry } from './defense-exhibits.service';
import { disputeScopeService, type DisputeScope } from './dispute-scope.service';
import { defenseReadinessService } from './defense-readiness.service';
import { logger } from '../utils/logger';
import { SS_CONTACT_FIELDS, WORKFLOW_DEFENSE_CONTACT_FIELDS } from '../constants/ghl-fields';

// Reason-code → network/category/deadline resolution lives in the registry.
// An unknown code maps to the 'general' category (generic evidence presentation)
// and forces needs_review — it must never be silently argued as a specific
// dispute type it isn't.
import { resolveReasonCode } from '../constants/reason-codes';

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
    const reasonInfo = resolveReasonCode(input.reasonCode);
    const category = reasonInfo?.category || 'general';
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
    const processor: 'stripe' | 'nmi' = input.processor || (input.disputeEventId ? 'stripe' : 'nmi');
    const addressee = input.addressee
      || (processor === 'stripe' ? 'Stripe Disputes Team' : 'Sponsor Bank — Chargeback Department');

    // An unrecognized reason code means we cannot select the right defense
    // strategy — the packet gets generic evidence presentation and MUST be
    // reviewed by the merchant before submission.
    const unknownReasonCode = !resolveReasonCode(input.reasonCode);

    // 0. Resolve the disputed transaction to a specific enrollment/program BEFORE
    // gathering any evidence. This is the guard against dumping contact-wide evidence.
    const scope = await disputeScopeService.resolveDisputeScope({
      locationId: input.locationId,
      contactId: input.contactId,
      paymentEventId: input.paymentEventId,
      enrollmentId: input.enrollmentId,
      offerId: input.offerId,
    });

    // Persist the resolved linkage back onto the packet (paymentEventId is no longer dead weight).
    if (scope.enrollmentId || scope.offerId) {
      await defenseRepository.updateStatus(defenseId, 'processing', {
        enrollment_id: scope.enrollmentId || undefined,
        offer_id: scope.offerId || undefined,
      } as any);
    }

    // 1. Look up reason code strategy + defense template FIRST — the strategy's
    // evidence_priorities drives exhibit ordering (most persuasive first for
    // this specific code), so it must exist before the exhibit list is built.
    const strategy = await defenseRepository.getReasonCodeStrategy(input.reasonCode);
    const template = await defenseRepository.getDefenseTemplate(category);
    const evidencePriorities = normalizeEvidencePriorities(strategy?.evidence_priorities);

    // 2. Build the single-source-of-truth exhibit list, scoped to the resolved enrollment.
    const exhibitScope = {
      enrollmentId: scope.enrollmentId || undefined,
      scopeConfidence: scope.scopeConfidence,
      offerId: scope.offerId,
      enrollmentStart: scope.enrollmentStart,
      enrollmentEnd: scope.enrollmentEnd,
      evidencePriorities,
    };
    const exhibitList = await defenseExhibitsService.buildExhibitList(input.locationId, input.contactId, exhibitScope);

    // 2b. Reason-code readiness check: does the evidence on file actually support
    // fighting THIS dispute type? Missing required evidence or an indefensible
    // fact pattern (e.g. billed after a cancellation request) holds the packet
    // for review with an honest recommendation instead of confident prose.
    const readiness = defenseReadinessService.assess(category, exhibitList, scope);

    // 3. Also gather raw evidence snapshot for the packet row (legacy column, still useful for debug)
    const evidence = await evidenceRepository.getFullSnapshot(input.locationId, input.contactId);
    await defenseRepository.updateStatus(defenseId, 'processing', {
      evidence_snapshot: evidence,
      evidence_count: exhibitList.exhibits.length,
    } as any);

    // 4. Get undisputed payments (Prior Undisputed Transactions section), scoped to
    // this enrollment when known so sibling-program payments don't pollute the main story.
    const undisputedPayments = await paymentService.getUndisputedPayments(
      input.locationId, input.contactId, scope.enrollmentId || undefined,
    );

    // 5. Get contact details from GHL
    let contactDetails: Record<string, unknown> = {};
    try {
      const api = await ghlApi(input.locationId);
      const contactRes = await api.get(`/contacts/${input.contactId}`);
      contactDetails = contactRes.data.contact || contactRes.data;
    } catch (err) {
      logger.warn({ err, contactId: input.contactId }, 'Failed to fetch contact details');
    }

    // 6. Get merchant info
    const merchant = await merchantRepository.getByLocationId(input.locationId);

    // 7. Build the AI prompt with the rewritten clinical-tone structure
    const systemPrompt = this.buildSystemPrompt(category, strategy, template);
    const userMessage = this.buildUserMessage(
      input, contactDetails, merchant, exhibitList, undisputedPayments, category, scope,
    );

    // 8. Call Claude API. If the AI provider is unavailable AFTER retries, still produce
    // a structured, transaction-specific fallback packet (not a generic "evidence found"
    // paragraph), and mark it for review rather than complete.
    let result: { text: string; inputTokens: number; outputTokens: number };
    let modelUsed = 'claude';
    let usedFallback = false;
    try {
      result = await callClaude(systemPrompt, userMessage, 8192);
    } catch (err: any) {
      modelUsed = 'fallback';
      usedFallback = true;
      logger.warn(
        { err: err?.message || String(err), defenseId },
        'AI defense letter generation failed after retries; using structured fallback letter',
      );
      result = {
        inputTokens: 0,
        outputTokens: 0,
        text: this.buildStructuredFallbackLetter(
          input, scope, exhibitList, undisputedPayments, merchant, contactDetails, addressee,
        ),
      };
    }

    // 9. Write the letter to defense_letter_versions as version 1 and mirror to the fast-read column
    try {
      await supabase.from('defense_letter_versions').insert({
        defense_packet_id: defenseId,
        version_number: 1,
        letter_text: result.text,
        generated_by: modelUsed === 'fallback' ? 'system' : 'ai',
        model_used: modelUsed,
        prompt_tokens_used: result.inputTokens,
        response_tokens_used: result.outputTokens,
      });
    } catch (vErr: any) {
      logger.warn({ err: vErr.message, defenseId }, 'Failed to insert letter version row (non-fatal — letter still saved on packet)');
    }

    await defenseRepository.updateStatus(defenseId, 'processing', {
      defense_letter_text: result.text,
      prompt_tokens_used: result.inputTokens,
      response_tokens_used: result.outputTokens,
      template_id: template?.id || null,
    });

    // 10. Generate bundled PDF before marking ready. A missing signed packet or
    // failed bundle is a defense integrity problem, so it must not fire ready.
    let defensePacketUrl = '';
    try {
      const { defenseBundleService } = require('./defense-bundle.service');
      defensePacketUrl = await defenseBundleService.bundleDefensePdf(defenseId, input.locationId, input.contactId, exhibitScope);
    } catch (pdfErr: any) {
      logger.error({ err: pdfErr.message, defenseId }, 'Bundled PDF generation failed; defense packet not marked ready');
      await defenseRepository.updateStatus(defenseId, 'failed', {
        error_message: `Defense packet PDF generation failed: ${pdfErr.message}`,
      } as any);
      return;
    }

    if (!defensePacketUrl) {
      await defenseRepository.updateStatus(defenseId, 'failed', {
        error_message: 'Defense packet PDF generation failed: no PDF URL returned',
      } as any);
      return;
    }

    // A packet must NOT be presented as a finished defense when the AI draft fell back
    // OR when we could not scope the evidence to the disputed transaction. Mark those
    // needs_review and do not fire the "ready" workflow.
    const needsReview = usedFallback
      || scope.scopeConfidence === 'contact_only'
      || unknownReasonCode
      || readiness.redFlags.length > 0
      || readiness.missingEvidence.length > 0;
    const finalStatus = needsReview ? 'needs_review' : 'complete';
    const reviewReasons: string[] = [];
    if (readiness.recommendAccept) reviewReasons.push('RECOMMENDATION: consider accepting this dispute rather than fighting it.');
    if (readiness.redFlags.length) reviewReasons.push(...readiness.redFlags);
    if (readiness.missingEvidence.length) reviewReasons.push(...readiness.missingEvidence);
    if (usedFallback) reviewReasons.push('AI draft was unavailable; a structured fallback letter was generated.');
    if (scope.scopeConfidence === 'contact_only') reviewReasons.push('The disputed transaction could not be tied to a specific program; evidence is contact-wide.');
    if (unknownReasonCode) reviewReasons.push(`Reason code "${input.reasonCode}" is not recognized; the letter uses a generic strategy and must be reviewed against the network's actual requirements for this code.`);
    if (scope.gaps.length) reviewReasons.push(...scope.gaps);

    await defenseRepository.updateStatus(defenseId, finalStatus, {
      defense_letter_text: result.text,
      prompt_tokens_used: result.inputTokens,
      response_tokens_used: result.outputTokens,
      template_id: template?.id || null,
      completed_at: new Date().toISOString(),
      error_message: needsReview ? reviewReasons.join(' ') : null,
    } as any);

    if (needsReview) {
      logger.info({ defenseId, usedFallback, scopeConfidence: scope.scopeConfidence }, 'Defense packet marked needs_review; ss_defense_ready not fired');
      // Reflect a non-ready state on the contact; do not advertise the packet as ready.
      try {
        const api = await ghlApi(input.locationId);
        await api.put(`/contacts/${input.contactId}`, {
          customField: { [SS_CONTACT_FIELDS.DEFENSE_STATUS]: 'preparing' },
        });
      } catch (err) {
        logger.warn({ err }, 'Failed to update defense (needs_review) status on contact');
      }
      logger.info({
        defenseId,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        exhibitCount: exhibitList.exhibits.length,
      }, 'Defense compilation complete (needs_review)');
      return;
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
      canceled_recurring: 'The cardholder claims they canceled a recurring payment before this charge. Lead with the cancellation record (or the documented absence of any cancellation request before the billing date), the express consent to recurring billing from the signed enrollment terms, and any service usage after the claimed cancellation date. State cancellation and billing dates precisely — the sequence of dates decides this dispute. If a cancellation request predates the charge, do not argue otherwise; state the facts as they are.',
      misrepresentation: 'The cardholder claims the offer was misrepresented at the time of purchase. Present the exact terms as shown and accepted at enrollment (the signed enrollment packet with T&C version hash), disclosure of the payment schedule, and any advance notice of upcoming charges. Compare what was disclosed against what was billed — do not characterize marketing claims; cite only the accepted terms.',
      canceled_services: 'The cardholder claims they canceled the service. Present the cancellation policy as disclosed and accepted at enrollment, whether the cardholder followed that policy, and any continued service usage after the claimed cancellation. State the policy terms and the dates factually.',
      duplicate_processing: 'The cardholder claims a duplicate or erroneous charge. Present payment records showing each charge corresponds to a distinct obligation (separate offers, separate installments, or an authorization vs. a settlement). Cite transaction identifiers, amounts, and dates for each charge separately.',
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
3. Transaction Timeline — a brief chronological list reproducing the TRANSACTION TIMELINE block from the evidence below verbatim (dates and exhibit letters exactly as given); omit if no timeline block is provided
4. Evidence of authorization / enrollment (cite consent exhibits)
5. Evidence of service delivery (cite delivery exhibits)
6. Prior Undisputed Transactions section — ONLY when a "PRIOR UNDISPUTED TRANSACTIONS" block appears in the evidence below; otherwise omit this section entirely
7. Conclusion (factual summary, not argumentative)
8. Exhibit index (numbered list of all cited exhibits)
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
    scope?: DisputeScope,
  ): string {
    const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    const clientName = [contact.firstName || '', contact.lastName || ''].filter(Boolean).join(' ') || 'Client';
    const clientEmail = (contact.email as string) || 'not on file';
    const addressee = input.addressee || 'Dispute Resolution Department';

    let msg = `TODAY'S DATE: ${today}\n\n`;
    msg += `ADDRESSEE: ${addressee}\n\n`;

    // Anchor the letter on the specific disputed transaction/program so the model
    // writes about THIS charge, not the contact's whole history.
    if (scope) {
      msg += `DISPUTED TRANSACTION SCOPE:\n`;
      msg += `- Program/Offer: ${scope.offerName || (scope.offerId ? `offer ${scope.offerId}` : 'not resolved')}\n`;
      if (scope.processorTransactionId) msg += `- Processor Transaction ID: ${scope.processorTransactionId}\n`;
      if (scope.enrollmentStart) msg += `- Enrollment/Service Window: ${scope.enrollmentStart}${scope.enrollmentEnd ? ` to ${scope.enrollmentEnd}` : ' onward'}\n`;
      msg += `- Scope Confidence: ${scope.scopeConfidence}\n`;
      if (scope.scopeConfidence === 'contact_only') {
        msg += `  NOTE: The disputed charge could not be tied to a single program. Write conservatively and do NOT assert program-specific service delivery that isn't in the exhibits below.\n`;
      }
      if (scope.gaps.length) {
        msg += `- Evidence gaps: ${scope.gaps.join(' ')}\n`;
      }
      msg += `\n`;
    }

    msg += `DISPUTE DETAILS:\n`;
    msg += `- Case/ARN Number: ${input.caseNumber || 'information not provided'}\n`;
    msg += `- Reason Code: ${input.reasonCode}\n`;
    msg += `- Disputed Amount: $${Number(input.disputeAmount).toFixed(2)}\n`;
    msg += `- Dispute Date: ${input.disputeDate}\n`;
    msg += `- Response Deadline: ${input.deadline}\n\n`;

    // Chronological transaction timeline — the reviewer's fastest path to
    // "engagement continued after purchase". The letter reproduces this as a
    // brief chronology section using the exact dates and exhibit letters.
    const timelineRows = buildTimelineRows(exhibitList.exhibits, {
      transactionDate: scope?.transactionDate,
      disputeDate: input.disputeDate,
    });
    if (timelineRows.length > 1) {
      msg += `═══ TRANSACTION TIMELINE (chronological — reproduce as a "Transaction Timeline" section in the letter) ═══\n`;
      for (const row of timelineRows) {
        const d = new Date(row.date).toISOString().slice(0, 10);
        msg += row.isMarker
          ? `  ${d}  ** ${row.label} **\n`
          : `  ${d}  ${row.label}${row.exhibitLetter ? ` (Exhibit ${row.exhibitLetter})` : ''}\n`;
      }
      msg += `\n`;
    }

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

    // 6. Prior Undisputed Transactions — only where they carry evidentiary weight:
    // fraud/authorization (prior clean history on the same credential rebuts
    // "I didn't authorize this") and canceled-recurring (payment continuity shows
    // an ongoing accepted arrangement). For other dispute types they are filler
    // that dilutes the reviewer's attention, so they are omitted entirely.
    const PRIOR_PAYMENT_CATEGORIES = new Set(['fraud', 'authorization', 'canceled_recurring']);
    if (PRIOR_PAYMENT_CATEGORIES.has(category)) {
      msg += `═══ PRIOR UNDISPUTED TRANSACTIONS (${undisputedPayments.length}) ═══\n`;
      if (undisputedPayments.length === 0) {
        msg += `  No prior undisputed transactions on record.\n\n`;
      } else {
        for (const p of undisputedPayments) {
          msg += `  - ${p.payment_date || p.created_at}: $${Number(p.amount || 0).toFixed(2)}\n`;
        }
        msg += `\n`;
      }
    } else {
      msg += `Do NOT include a "Prior Undisputed Transactions" section — it is not relevant to this dispute type.\n\n`;
    }

    msg += `Generate the defense letter now. Use the exact exhibit letters (A, B, C…) provided above. Do not add or skip any.`;
    return msg;
  },

  /**
   * Deterministic, transaction-specific fallback letter used ONLY when the AI provider
   * is unavailable after retries. This intentionally does NOT use the old generic
   * "ScaleSafe found X evidence records" paragraph — it is a real, structured response
   * built from the resolved scope and categorized exhibits, and the packet that carries
   * it is marked needs_review (never complete, never fires ss_defense_ready).
   */
  buildStructuredFallbackLetter(
    input: CompileDefenseInput,
    scope: DisputeScope,
    exhibitList: ExhibitList,
    undisputedPayments: any[],
    merchant: any,
    contact: Record<string, unknown>,
    addressee: string,
  ): string {
    const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    const clientName = [contact.firstName || '', contact.lastName || ''].filter(Boolean).join(' ') || 'the cardholder';
    const businessName = merchant?.business_name || 'The merchant';
    const programName = scope.offerName || 'the purchased program';
    const byCat = exhibitList.byCategory;

    const exhibitRef = (ex: ExhibitEntry) => `Exhibit ${ex.letter} (${ex.name})`;
    const listExhibits = (rows: ExhibitEntry[]) =>
      rows.length ? rows.map((ex) => `  - ${exhibitRef(ex)}: ${ex.summary}`).join('\n') : '  - None on file.';

    let msg = `${today}\n\n${addressee}\n\n`;
    msg += `RE: Chargeback Dispute Response`;
    msg += ` — Case Number: ${input.caseNumber || 'information not provided'}`;
    msg += ` — Reason Code: ${input.reasonCode}`;
    msg += ` — Disputed Amount: $${Number(input.disputeAmount).toFixed(2)}`;
    msg += ` — Merchant: ${businessName}\n\n`;

    msg += `TRANSACTION AND PROGRAM\n`;
    msg += `${businessName} responds to the chargeback filed by ${clientName} disputing a `;
    msg += `$${Number(input.disputeAmount).toFixed(2)} charge dated ${input.disputeDate}. `;
    msg += `This response concerns ${programName}`;
    if (scope.processorTransactionId) msg += ` (processor transaction ${scope.processorTransactionId})`;
    msg += `. `;
    if (scope.enrollmentStart) {
      msg += `The service window on record runs from ${scope.enrollmentStart}${scope.enrollmentEnd ? ` to ${scope.enrollmentEnd}` : ' onward'}. `;
    }
    if (scope.scopeConfidence === 'contact_only') {
      msg += `NOTE: This charge could not be tied to a single program; the evidence below is drawn from the cardholder's account and must be reviewed before submission.`;
    }
    msg += `\n\n`;

    msg += `AUTHORIZATION / CONSENT EVIDENCE\n`;
    msg += `${listExhibits(byCat.consent)}\n\n`;

    msg += `SERVICE DELIVERY EVIDENCE\n`;
    msg += `${listExhibits(byCat.service_delivery)}\n\n`;

    msg += `PAYMENT / REFUND / CANCELLATION CONTEXT\n`;
    msg += `${listExhibits([...byCat.payments, ...byCat.termination])}\n\n`;

    msg += `PRIOR PAYMENT / RELATIONSHIP CONTEXT\n`;
    if (undisputedPayments.length === 0) {
      msg += `  - No prior undisputed transactions are on record for this cardholder.\n`;
    } else {
      for (const p of undisputedPayments) {
        msg += `  - ${p.payment_date || p.created_at}: $${Number(p.amount || 0).toFixed(2)}\n`;
      }
    }
    if (byCat.communication.length) {
      msg += `  Documented communications: ${byCat.communication.length} exhibit(s) on file (${byCat.communication.map((ex) => ex.letter).join(', ')}).\n`;
    }
    msg += `\n`;

    msg += `EVIDENCE GAPS\n`;
    if (scope.gaps.length) {
      for (const g of scope.gaps) msg += `  - ${g}\n`;
    } else {
      msg += `  - None identified during scope resolution.\n`;
    }
    msg += `\n`;

    msg += `EXHIBIT INDEX\n`;
    if (exhibitList.exhibits.length) {
      for (const ex of exhibitList.exhibits) {
        msg += `  ${exhibitRef(ex)}${ex.occurredAt ? ` — ${ex.occurredAt}` : ''}\n`;
      }
    } else {
      msg += `  - No exhibits were assembled for this transaction.\n`;
    }
    msg += `\n`;

    msg += `This response was assembled by ScaleSafe from the exhibits listed above. `;
    msg += `It requires merchant review before submission.\n\n`;
    msg += `Respectfully submitted,\n${businessName}`;

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

    // Resolve scope the same way the initial compilation does, so a regenerated letter
    // stays transaction-specific instead of falling back to contact-wide evidence.
    const scope = await disputeScopeService.resolveDisputeScope({
      locationId: input.locationId,
      contactId: input.contactId,
      paymentEventId: (packet as any).payment_event_id || undefined,
      enrollmentId: input.enrollmentId,
      offerId: (packet as any).offer_id || undefined,
    });
    const strategy = await defenseRepository.getReasonCodeStrategy(input.reasonCode);
    const template = await defenseRepository.getDefenseTemplate(category);
    const exhibitScope = {
      enrollmentId: scope.enrollmentId || undefined,
      scopeConfidence: scope.scopeConfidence,
      offerId: scope.offerId,
      enrollmentStart: scope.enrollmentStart,
      enrollmentEnd: scope.enrollmentEnd,
      evidencePriorities: normalizeEvidencePriorities(strategy?.evidence_priorities),
    };
    const exhibitList = await defenseExhibitsService.buildExhibitList(input.locationId, input.contactId, exhibitScope);
    const undisputedPayments = await paymentService.getUndisputedPayments(
      input.locationId, input.contactId, scope.enrollmentId || undefined,
    );
    let contactDetails: Record<string, unknown> = {};
    try {
      const api = await ghlApi(input.locationId);
      const contactRes = await api.get(`/contacts/${input.contactId}`);
      contactDetails = contactRes.data.contact || contactRes.data;
    } catch {}
    const merchant = await merchantRepository.getByLocationId(input.locationId);

    const systemPrompt = this.buildSystemPrompt(category, strategy, template);
    const userMessage = this.buildUserMessage(input, contactDetails, merchant, exhibitList, undisputedPayments, category, scope);
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
      await defenseBundleService.bundleDefensePdf(defenseId, input.locationId, input.contactId, exhibitScope);
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

    // Rebundle PDF using the same resolved scope as compilation so the exhibit list
    // in the PDF stays consistent with the edited letter (contact_only packets must
    // keep their contact-wide exhibits rather than scoping to nothing).
    try {
      const { defenseBundleService } = require('./defense-bundle.service');
      const scope = await disputeScopeService.resolveDisputeScope({
        locationId: packet.location_id,
        contactId: packet.contact_id,
        paymentEventId: (packet as any).payment_event_id || undefined,
        enrollmentId: packet.enrollment_id || undefined,
        offerId: (packet as any).offer_id || undefined,
      });
      await defenseBundleService.bundleDefensePdf(defenseId, packet.location_id, packet.contact_id, {
        enrollmentId: scope.enrollmentId || undefined,
        scopeConfidence: scope.scopeConfidence,
        offerId: scope.offerId,
        enrollmentStart: scope.enrollmentStart,
        enrollmentEnd: scope.enrollmentEnd,
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
