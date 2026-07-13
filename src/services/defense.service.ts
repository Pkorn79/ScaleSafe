import { callClaude } from '../clients/anthropic.client';
import { ghlApi } from '../clients/ghl.client';
import { getSupabase } from '../clients/supabase.client';
import { defenseRepository } from '../repositories/defense.repository';
import { merchantRepository } from '../repositories/merchant.repository';
import { paymentService } from './payment.service';
import { triggerService } from './trigger.service';
import { storageService } from './storage.service';
import { defenseExhibitsService, normalizeEvidencePriorities, buildTimelineRows, type ExhibitList, type ExhibitEntry } from './defense-exhibits.service';
import { disputeScopeService, type DisputeScope } from './dispute-scope.service';
import { defenseReadinessService, evaluateReviewState } from './defense-readiness.service';
import { defenseSubmissionService } from './defense-submission.service';
import { offerRepository } from '../repositories/offer.repository';
import { logger } from '../utils/logger';
import { AppError, ValidationError, ConflictError, ExternalServiceError } from '../utils/errors';
import { SS_CONTACT_FIELDS, WORKFLOW_DEFENSE_CONTACT_FIELDS } from '../constants/ghl-fields';

// Reason-code → network/category/deadline resolution lives in the registry.
// An unknown code maps to the 'general' category (generic evidence presentation)
// and forces needs_review — it must never be silently argued as a specific
// dispute type it isn't.
import { resolveReasonCode } from '../constants/reason-codes';

/**
 * What the client actually purchased — the offer as presented and accepted at
 * enrollment. Fed into the letter prompt so the letter can explain the program
 * in plain language (what it is, what it includes, how it is delivered, what
 * it cost) before arguing about delivery. Without this the model only knows
 * the program's NAME, which reads as an evidence dump with no story.
 */
export interface OfferContext {
  offerName: string;
  description: string | null;
  deliveryMethod: string | null;
  /** Human sentence: "$1.00 total (2 daily payments of $0.50)" */
  priceText: string | null;
  refundPolicy: string | null;
  /** Milestones promised at enrollment, each individually acknowledged by the client. */
  milestones: Array<{ name: string; delivers: string; clientDoes: string }>;
}

export interface CompileDefenseInput {
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

async function requireCurrentDefenseBundle(packet: any): Promise<any> {
  if (!packet.defense_letter_text) {
    throw new ValidationError('This defense packet does not have a letter to submit.');
  }
  const { data: latestVersion, error } = await getSupabase()
    .from('defense_letter_versions')
    .select('id, version_number, generated_by, letter_text')
    .eq('defense_packet_id', packet.id)
    .order('version_number', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!latestVersion) throw new ValidationError('This defense packet has no saved letter version.');

  const expectedPath = `defense-packets/${packet.location_id}/${packet.id}-v${latestVersion.version_number}.pdf`;
  if (packet.pdf_storage_path !== expectedPath) {
    throw new ValidationError('The defense PDF is not current with the latest letter. Rebuild or regenerate the packet before submitting.');
  }
  return latestVersion;
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
        logger.error({ err: err.message, locationId: input.locationId }, 'Failed to create required NMI dispute_event row');
        throw new Error(`Could not create the NMI dispute record: ${err.message}`);
      }
    }

    // Resolve addressee — default per processor if merchant didn't override
    const addressee = input.addressee
      || (processor === 'stripe' ? 'Stripe Disputes Team' : 'Sponsor Bank — Chargeback Department');

    const compilationInput: CompileDefenseInput = {
      ...input,
      disputeEventId: disputeEventId || undefined,
      processor,
      addressee,
    };

    // Create the durable queue row. Migration 098 stores the complete,
    // validated compilation input so a database-leased worker can resume it.
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
      compilation_input: compilationInput,
      compilation_category: category,
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

    logger.info({ defenseId: packet.id, reasonCode: input.reasonCode, category }, 'Defense compilation queued');
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
    const readiness = defenseReadinessService.assess(category, exhibitList, scope, {
      amount: input.disputeAmount,
      date: input.disputeDate,
    });

    // 3. Freeze the exact scoped exhibit set used by the letter and PDF. Never
    // store a contact-wide timeline as the packet snapshot for a scoped dispute.
    const evidence = {
      scope,
      exhibits: exhibitList.exhibits,
      sourceErrors: exhibitList.sourceErrors || [],
      capturedAt: new Date().toISOString(),
    };
    await defenseRepository.updateStatus(defenseId, 'processing', {
      evidence_snapshot: evidence,
      evidence_count: exhibitList.exhibits.length,
    } as any);

    // 4. Get undisputed payments (Prior Undisputed Transactions section), scoped to
    // this enrollment when known so sibling-program payments don't pollute the main story.
    const undisputedPayments = await paymentService.getUndisputedPayments(
      input.locationId, input.contactId, scope.enrollmentId || undefined,
      {
        paymentEventId: scope.paymentEventId,
        processorTransactionId: scope.processorTransactionId,
        onOrAfter: scope.transactionDate,
      },
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

    // 6b. What was sold — the frozen offer terms, so the letter explains the
    // purchase before arguing about delivery.
    const offerContext = await this.getOfferContext(input.locationId, scope.offerId);

    // 7. Build the AI prompt with the rewritten clinical-tone structure
    const systemPrompt = this.buildSystemPrompt(category, strategy, template);
    const userMessage = this.buildUserMessage(
      input, contactDetails, merchant, exhibitList, undisputedPayments, category, scope, offerContext,
    );

    // 8. Call Claude API. If the AI provider is unavailable AFTER retries (and any
    // configured fallback models), still produce a structured, transaction-specific
    // fallback packet (not a generic "evidence found" paragraph), and mark it for
    // review rather than complete. The true provider failure is preserved in
    // internal_debug; error_message stays merchant-facing.
    let result: { text: string; inputTokens: number; outputTokens: number };
    let modelUsed = 'claude';
    let usedFallback = false;
    let modelAttempts: unknown = null;
    let aiFailure: { message: string; status?: number } | null = null;
    try {
      // 16000: adaptive-thinking models (claude-sonnet-5+) spend thinking tokens
      // out of the same max_tokens budget as the letter text.
      const ai = await callClaude(systemPrompt, userMessage, 16000);
      result = ai;
      modelUsed = ai.model || 'claude';
      modelAttempts = ai.modelAttempts || null;
    } catch (err: any) {
      modelUsed = 'fallback';
      usedFallback = true;
      aiFailure = { message: err?.message || String(err), status: err?.response?.status };
      modelAttempts = err?.modelAttempts || null;
      logger.warn(
        { err: aiFailure.message, status: aiFailure.status, modelAttempts, defenseId },
        'AI defense letter generation failed after retries; using structured fallback letter',
      );
      result = {
        inputTokens: 0,
        outputTokens: 0,
        text: this.buildStructuredFallbackLetter(
          input, scope, exhibitList, undisputedPayments, merchant, contactDetails, addressee, offerContext,
        ),
      };
    }

    // 9. Write the letter to defense_letter_versions as version 1 and mirror to the
    // fast-read column. A retry can collide with an already-committed version 1;
    // that stored row is authoritative for every downstream artifact.
    let versionWriteError: any = null;
    try {
      const { error: versionErr } = await supabase.from('defense_letter_versions').insert({
        defense_packet_id: defenseId,
        version_number: 1,
        letter_text: result.text,
        generated_by: modelUsed === 'fallback' ? 'system' : 'ai',
        model_used: modelUsed,
        prompt_tokens_used: result.inputTokens,
        response_tokens_used: result.outputTokens,
        notes: usedFallback ? 'Structured fallback letter — AI provider unavailable' : null,
      });
      versionWriteError = versionErr;
    } catch (vErr: any) {
      versionWriteError = vErr;
    }

    if (versionWriteError) {
      let storedVersion: any = null;
      let storedVersionError: any = null;
      try {
        const stored = await supabase
          .from('defense_letter_versions')
          .select('version_number, letter_text, generated_by, model_used, prompt_tokens_used, response_tokens_used')
          .eq('defense_packet_id', defenseId)
          .eq('version_number', 1)
          .maybeSingle();
        storedVersion = stored.data;
        storedVersionError = stored.error;
      } catch (readErr: any) {
        storedVersionError = readErr;
      }

      if (storedVersionError || typeof storedVersion?.letter_text !== 'string' || !storedVersion.letter_text.trim()) {
        logger.error({
          err: versionWriteError?.message || String(versionWriteError),
          readErr: storedVersionError?.message,
          defenseId,
        }, 'Letter version 1 could not be locked or recovered; compilation stopped');
        await defenseRepository.updateStatus(defenseId, 'failed', {
          error_message: 'Defense letter version could not be locked. Compilation stopped before PDF generation.',
        } as any);
        return;
      }

      const storedInputTokens = Number(storedVersion.prompt_tokens_used);
      const storedOutputTokens = Number(storedVersion.response_tokens_used);
      result = {
        text: storedVersion.letter_text,
        inputTokens: Number.isFinite(storedInputTokens) ? storedInputTokens : 0,
        outputTokens: Number.isFinite(storedOutputTokens) ? storedOutputTokens : 0,
      };
      modelUsed = storedVersion.model_used || (storedVersion.generated_by === 'system' ? 'fallback' : 'stored');
      usedFallback = storedVersion.generated_by === 'system';
      aiFailure = null;
      modelAttempts = null;
      logger.warn({
        defenseId,
        versionNumber: storedVersion.version_number,
        insertErr: versionWriteError?.message || String(versionWriteError),
      }, 'Letter version 1 already exists; reusing the stored letter for compilation retry');
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

    // A packet must NOT be presented as a finished defense when the AI draft fell back,
    // when we could not scope the evidence to the disputed transaction, OR when an
    // evidence source query failed (the packet is missing that source entirely). Mark
    // those needs_review and do not fire the "ready" workflow.
    const sourceErrors = exhibitList.sourceErrors || [];
    const { needsReview, reviewReasons } = evaluateReviewState({
      usedFallback,
      scope,
      unknownReasonCode,
      readiness,
      sourceErrors,
      reasonCode: input.reasonCode,
    });
    const finalStatus = needsReview ? 'needs_review' : 'complete';

    await defenseRepository.updateStatus(defenseId, finalStatus, {
      defense_letter_text: result.text,
      prompt_tokens_used: result.inputTokens,
      response_tokens_used: result.outputTokens,
      template_id: template?.id || null,
      completed_at: new Date().toISOString(),
      error_message: needsReview ? reviewReasons.join(' ') : null,
    } as any);

    // Preserve the true failure internals for debugging (never merchant-facing).
    // Written with its own guarded update so a missing column (migration 086 not
    // yet applied) degrades to a warn log instead of failing compilation.
    const internalDebug: Record<string, unknown> = {};
    if (aiFailure) internalDebug.ai_failure = aiFailure;
    if (modelAttempts) internalDebug.model_attempts = modelAttempts;
    if (!usedFallback) internalDebug.final_model_used = modelUsed;
    if (sourceErrors.length) internalDebug.exhibit_source_errors = sourceErrors;
    if (Object.keys(internalDebug).length) {
      try {
        const { error: dbgErr } = await supabase
          .from('defense_packets')
          .update({ internal_debug: internalDebug })
          .eq('id', defenseId)
          .eq('location_id', input.locationId);
        if (dbgErr) logger.warn({ err: dbgErr.message, defenseId }, 'Failed to persist internal_debug (is migration 086 applied?)');
      } catch (dbgErr: any) {
        logger.warn({ err: dbgErr.message, defenseId }, 'Failed to persist internal_debug (is migration 086 applied?)');
      }
    }

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

  /**
   * Load the offer the disputed enrollment was for, shaped for the letter
   * prompt. Returns null (never throws) when the offer can't be resolved —
   * the letter falls back to name-only and the scope gaps already cover it.
   */
  async getOfferContext(locationId: string, offerId: string | null | undefined): Promise<OfferContext | null> {
    if (!offerId) return null;
    try {
      const offer: any = await offerRepository.findById(offerId, locationId);
      if (!offer) return null;

      const milestones: OfferContext['milestones'] = [];
      for (let i = 1; i <= 8; i++) {
        const name = offer[`m${i}_name`];
        if (name) {
          milestones.push({
            name,
            delivers: offer[`m${i}_delivers`] || '',
            clientDoes: offer[`m${i}_client_does`] || '',
          });
        }
      }

      let priceText: string | null = null;
      const total = Number(offer.price || 0);
      if (offer.payment_type === 'installment' && offer.installment_amount) {
        const freq = String(offer.installment_frequency || 'monthly').replace(/_/g, ' ');
        priceText = `${total ? `$${total.toFixed(2)} total` : 'Installment plan'} (${offer.num_payments || '?'} ${freq} payments of $${Number(offer.installment_amount).toFixed(2)})`;
      } else if (total) {
        priceText = `$${total.toFixed(2)}, paid in full`;
      }

      return {
        offerName: offer.offer_name || '',
        description: offer.program_description || null,
        deliveryMethod: offer.delivery_method || null,
        priceText,
        refundPolicy: offer.refund_window_text || null,
        milestones,
      };
    } catch (err: any) {
      logger.warn({ err: err.message, offerId, locationId }, 'Failed to load offer context for defense letter');
      return null;
    }
  },

  buildSystemPrompt(category: string, strategy: any, template: any): string {
    const categoryStrategies: Record<string, string> = {
      fraud: 'The cardholder claims they did not authorize this transaction. Link the enrollment consent record (IP, device fingerprint, digital signature) to the transaction. Show that the same person who enrolled also used the service. Reference the signed enrollment packet as the primary exhibit.',
      services_not_provided: 'The cardholder claims services were not provided. Itemize every delivered touchpoint with specific dates: session records, module completions, milestone sign-offs, platform access logs. Cite each as a numbered exhibit. Where a milestone has an associated client notification or sign-off request communication, connect them ("the milestone was completed on X and the client was notified the same day"). State sign-off status factually — "sign-off was requested on DATE" or "the client signed off on DATE" — never imply a confirmation that did not occur.',
      not_as_described: 'The cardholder claims the service was not as described. Compare the offer terms presented at enrollment (from the signed enrollment packet) against what was actually delivered. Show the client reviewed and agreed to terms before purchasing.',
      credit_not_processed: 'The cardholder claims a credit/refund was promised but not received. Present the refund policy from the enrollment terms, communication logs showing what was communicated about refunds, and any refund actions that were taken.',
      authorization: 'The cardholder disputes authorization. Focus on consent proof: the signed enrollment packet with T&C acceptance timestamp, IP address, device fingerprint, scroll depth, and digital signature. This is the strongest evidence for authorization disputes.',
      canceled_recurring: 'The cardholder claims they canceled a recurring payment before this charge. Lead with the cancellation record (or the documented absence of any cancellation request before the billing date), the express consent to recurring billing from the signed enrollment terms, and any service usage after the claimed cancellation date. State cancellation and billing dates precisely — the sequence of dates decides this dispute. If a cancellation request predates the charge, do not argue otherwise; state the facts as they are.',
      misrepresentation: 'The cardholder claims the offer was misrepresented at the time of purchase. Present the exact terms as shown and accepted at enrollment (the signed enrollment packet with T&C version hash), disclosure of the payment schedule, and any advance notice of upcoming charges. Compare what was disclosed against what was billed — do not characterize marketing claims; cite only the accepted terms.',
      canceled_services: 'The cardholder claims they canceled the service. Present the cancellation policy as disclosed and accepted at enrollment, whether the cardholder followed that policy, and any continued service usage after the claimed cancellation. State the policy terms and the dates factually.',
      duplicate_processing: 'The cardholder claims a duplicate or erroneous charge. Present payment records showing each charge corresponds to a distinct obligation (separate offers, separate installments, or an authorization vs. a settlement). Cite transaction identifiers, amounts, and dates for each charge separately.',
    };

    let prompt = `You are generating a chargeback defense letter. Your output will be submitted to a payment processor or bank as part of a formal dispute response.

VOICE — THIS LETTER IS WRITTEN BY THE MERCHANT:
- Write in the first person as the merchant ("We received...", "Our records show...", "We provided..."). The letter must read as if written by a careful business owner who keeps thorough records — human, plain, and direct. It is a letter FROM a merchant, not a report ABOUT one.
- Open with one plain sentence that says what this letter is: that we received this chargeback and are disputing it, with the one-line reason why. Shape: "We received chargeback case <number> for $<amount>, filed on <dispute date>, and we are disputing it because our records show the charge was authorized and the services were delivered."
- NEVER mention ScaleSafe, or any software, app, tool, platform, or "system" as the author, assembler, or source of this letter or its records. Refer to evidence as "our records", "our enrollment agreement", "our communication log". (The name of the program the client purchased may of course appear — that is what was sold.)

TONE AND STYLE:
- Use a factual tone throughout. State facts, dates, and amounts. Let the evidence speak for itself.
- Do NOT use argumentative, persuasive, or emotional language.
- Do NOT use phrases like "we strongly contest," "the cardholder is mistaken," "we believe," or "it is clear that."
- Do NOT write "Dear Issuing Bank" or "[CASE NUMBER]" or "[Current Date]" or any bracketed placeholder. All values must come from the data provided below — if a value is missing, write "information not provided" in plain text, never leave an unfilled bracket.

DISPUTE CATEGORY: ${category.replace(/_/g, ' ')}

STRATEGY: ${categoryStrategies[category] || 'Present all available evidence of service delivery and client engagement.'}

OFFER CONTEXT — USE IT:
When a "WHAT WAS SOLD" block appears in the evidence below, the letter must explain the purchase before arguing about it: what the program is in plain language a reviewer with no context understands, what it includes, how it is delivered, and what it cost. Describe the offer exactly as it was presented and accepted at enrollment (cite the enrollment/consent exhibit) — never as marketing copy. Then use it according to the dispute type:
- Delivery disputes (goods/services not provided): measure what was delivered against the promised deliverables, milestone by milestone. For self-paced or on-demand programs, provisioning access to the promised materials IS delivery — say so plainly.
- Description disputes (not as described / misrepresentation): compare the offer as described and accepted at enrollment against what was actually delivered.
- Billing disputes (canceled recurring / installments): state the payment structure the client expressly authorized and cite where they authorized it.
- Fraud/authorization disputes: tie the enrollment identity (IP, device, signature) to the post-purchase engagement — the person who enrolled went on to use the service.
- Refund disputes: state the refund policy the client accepted and what our records show about any refund activity.

EVIDENCE VARIETY:
Merchants capture different evidence depending on how their business runs — do not expect a fixed set. Use whatever is actually present in the exhibits: enrollment/consent records; completed milestones and client sign-offs; pulse check-in responses; inbound replies from the client; appointments and sessions; platform/service access records and activity captured from external platforms. Inbound client engagement (replies, check-ins, sign-offs) is especially strong for rebutting "no value received" claims — it shows the client was present and participating. Never invent or imply evidence types that are not in the exhibits.

CRITICAL RULES FOR EVENT INTERPRETATION:
- Cancellation events are TERMINATION events. State the cancellation date and reason factually. Do NOT characterize cancellations as evidence of ongoing service delivery or engagement. The active service period ended on the cancellation date.
- Refund events are financial resolution events. State whether a refund was issued, the amount, and the date. Do not editorialize on whether the refund was "fair."
- If the evidence shows a refund matching or covering the disputed amount was issued BEFORE the dispute was filed, that fact changes the whole response: state it in the opening paragraph and make it the basis of the Request section (a credit was already issued on <date>, before this dispute; we ask that the case be resolved accordingly and that no second recovery of the same funds occur). Never bury this fact mid-letter.
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
2. Opening paragraph: the plain first-person sentence described under VOICE, followed by precise identification of the disputed transaction — transaction date, processor transaction ID, amount, and (when the data shows it) its place in the payment plan. A reviewer must be able to match this response to the exact transaction from this paragraph alone.
3. What the client purchased — when a "WHAT WAS SOLD" block is provided: one short paragraph describing the program in plain language (what it is, what it includes, how it is delivered), the price and payment structure, and that the client reviewed and accepted these terms at enrollment (cite the consent exhibit). Omit this section only when no WHAT WAS SOLD block is provided.
4. Transaction Timeline — a brief chronological list reproducing the TRANSACTION TIMELINE block from the evidence below verbatim (dates and exhibit letters exactly as given); omit if no timeline block is provided
5. Evidence of authorization / enrollment (cite consent exhibits)
6. Evidence of service delivery — measured against what was promised in the WHAT WAS SOLD block when present (cite delivery exhibits)
7. Prior Undisputed Transactions section — ONLY when a "PRIOR UNDISPUTED TRANSACTIONS" block appears in the evidence below; otherwise omit this section entirely
8. Request — a short section stating plainly what we are asking the reviewer for: that this chargeback be declined/reversed based on the evidence above (or, when a credit was already issued before the dispute, that the case be resolved as credit previously issued with no second recovery). Factual, not pleading. Every letter must contain this section.
9. Conclusion (factual summary, not argumentative)
10. Exhibit index — one line per exhibit stating what it PROVES, not just what it is (e.g. "Exhibit A — Signed enrollment agreement: establishes authorization and the agreed terms")
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
    offer?: OfferContext | null,
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

    // What the client actually purchased — the frozen offer terms from enrollment.
    // This is what lets the letter tell a story a human reviewer understands
    // ("our client signed up for X, which provides Y...") instead of dumping evidence.
    if (offer) {
      msg += `═══ WHAT WAS SOLD (the offer as presented and accepted at enrollment) ═══\n`;
      msg += `- Program: ${offer.offerName}\n`;
      if (offer.description) msg += `- What it is: ${offer.description}\n`;
      if (offer.deliveryMethod) msg += `- Delivery method: ${offer.deliveryMethod}\n`;
      if (offer.priceText) msg += `- Price: ${offer.priceText}\n`;
      if (offer.refundPolicy) msg += `- Refund policy the client accepted: ${offer.refundPolicy}\n`;
      if (offer.milestones.length) {
        msg += `- Milestones promised at enrollment (each individually acknowledged by the client):\n`;
        offer.milestones.forEach((m, i) => {
          msg += `  ${i + 1}. ${m.name}`;
          if (m.delivers) msg += ` — Deliverables: ${m.delivers}`;
          if (m.clientDoes) msg += ` — Client responsibility: ${m.clientDoes}`;
          msg += `\n`;
        });
      }
      msg += `\n`;
    }

    msg += `DISPUTE DETAILS:\n`;
    msg += `- Case/ARN Number: ${input.caseNumber || 'information not provided'}\n`;
    msg += `- Reason Code: ${input.reasonCode}\n`;
    msg += `- Disputed Amount: $${Number(input.disputeAmount).toFixed(2)}\n`;
    // The disputed TRANSACTION (what the cardholder is charging back) — distinct
    // from the dispute filing date. The letter's opening must identify it precisely.
    if (scope?.transactionDate) msg += `- Disputed Transaction Date: ${new Date(scope.transactionDate).toISOString().slice(0, 10)}\n`;
    if (scope?.processorTransactionId) msg += `- Processor Transaction ID: ${scope.processorTransactionId}\n`;
    msg += `- Dispute Date (when the chargeback was filed): ${input.disputeDate}\n`;
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

    // 3. Communication and client-engagement exhibits. This group can include
    // scheduled/confirmed appointments; those records show engagement or an
    // opportunity to perform, but must never be described as completed delivery.
    if (exhibitList.byCategory.communication.length > 0) {
      msg += `═══ COMMUNICATION / CLIENT ENGAGEMENT EVIDENCE (${exhibitList.byCategory.communication.length} exhibits — scheduled appointments are NOT proof of completed delivery) ═══\n`;
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
    offer?: OfferContext | null,
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

    msg += `We received this chargeback and we are disputing it. `;
    msg += `Our records for the disputed transaction are summarized below, with each fact tied to an exhibit.\n\n`;

    msg += `TRANSACTION AND PROGRAM\n`;
    msg += `The cardholder, ${clientName}, disputes a $${Number(input.disputeAmount).toFixed(2)} charge`;
    if (scope.transactionDate) msg += ` dated ${new Date(scope.transactionDate).toISOString().slice(0, 10)}`;
    if (scope.processorTransactionId) msg += ` (processor transaction ${scope.processorTransactionId})`;
    msg += `; the chargeback was filed on ${input.disputeDate}. `;
    msg += `The purchase was for ${programName}. `;
    if (offer?.description) msg += `The program: ${offer.description} `;
    if (offer?.deliveryMethod) msg += `Delivery method: ${offer.deliveryMethod}. `;
    if (offer?.priceText) msg += `Program price: ${offer.priceText}. `;
    if (scope.enrollmentStart) {
      msg += `The service window on our records runs from ${scope.enrollmentStart}${scope.enrollmentEnd ? ` to ${scope.enrollmentEnd}` : ' onward'}. `;
    }
    if (scope.scopeConfidence === 'contact_only') {
      msg += `NOTE: our records could not tie this charge to a single program; the evidence below is drawn from the client's account history.`;
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

    msg += `REQUEST\n`;
    msg += `Based on the records above, we request that this chargeback be declined and the disputed funds returned to us.\n\n`;

    msg += `EXHIBIT INDEX\n`;
    if (exhibitList.exhibits.length) {
      for (const ex of exhibitList.exhibits) {
        msg += `  ${exhibitRef(ex)}${ex.occurredAt ? ` — ${ex.occurredAt}` : ''}\n`;
      }
    } else {
      msg += `  - No exhibits were assembled for this transaction.\n`;
    }
    msg += `\n`;

    msg += `All facts stated in this response are supported by the exhibits listed above.\n\n`;
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
    const shaped = await shapePacketResponseWithFreshUrl(packet);
    // Rail flag: Stripe-linked packets are pushed to Stripe by Mark Submitted,
    // so the UI must present that action as "Submit to Stripe".
    shaped.isStripeDispute = false;
    shaped.ce3 = null;
    if ((packet as any).dispute_event_id) {
      const { data: de } = await getSupabase()
        .from('dispute_events')
        .select('stripe_dispute_id, raw_dispute_object')
        .eq('id', (packet as any).dispute_event_id)
        .eq('location_id', packet.location_id)
        .maybeSingle();
      shaped.isStripeDispute = !!de?.stripe_dispute_id;
      if (de?.stripe_dispute_id) {
        const { stripeDisputeService } = require('./stripe-dispute.service');
        shaped.ce3 = stripeDisputeService.getCe3Eligibility(de);
      }
    }
    return shaped;
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
      .eq('id', defenseId)
      .eq('location_id', packet.location_id);

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
          .eq('id', disputeEventId)
          .eq('location_id', packet.location_id);
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
   * Auto-prepare a defense packet for a Stripe dispute (webhook path and
   * on-demand "Prepare defense" from the dispute queue). NEVER auto-submits —
   * the packet lands in the normal review flow with all needs_review gates.
   * Returns null when the dispute can't be tied to a ScaleSafe contact
   * (we refuse to guess; the merchant prepares manually from the queue).
   */
  async prepareForStripeDispute(params: { merchant: any; stripeDispute: any }): Promise<string | null> {
    const supabase = getSupabase();
    const { merchant, stripeDispute } = params;

    const { data: disputeEvent } = await supabase
      .from('dispute_events')
      .select('*')
      .eq('stripe_dispute_id', stripeDispute.id)
      .eq('merchant_id', merchant.id)
      .maybeSingle();
    if (!disputeEvent) {
      throw new Error(`No dispute_events row for Stripe dispute ${stripeDispute.id}`);
    }

    // Idempotent: one packet per dispute
    const { data: existingPacket } = await supabase
      .from('defense_packets')
      .select('id')
      .eq('dispute_event_id', disputeEvent.id)
      .eq('location_id', merchant.location_id)
      .limit(1)
      .maybeSingle();
    if (existingPacket?.id) {
      logger.info({ defenseId: existingPacket.id, stripeDisputeId: stripeDispute.id }, 'Defense packet already exists for dispute — skipping auto-prepare');
      return existingPacket.id;
    }

    // Resolve the disputed transaction → contact/enrollment. We only trust an
    // exact payment_events match on the PaymentIntent; no match = no guessing.
    const paymentIntentId = typeof stripeDispute.payment_intent === 'string'
      ? stripeDispute.payment_intent
      : stripeDispute.payment_intent?.id || null;
    let paymentEvent: any = null;
    if (paymentIntentId) {
      const { data } = await supabase
        .from('payment_events')
        .select('id, contact_id, enrollment_id')
        .eq('location_id', merchant.location_id)
        .eq('processor', 'stripe')
        .eq('processor_transaction_id', paymentIntentId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      paymentEvent = data || null;
    }
    if (!paymentEvent?.contact_id) {
      logger.warn(
        { stripeDisputeId: stripeDispute.id, paymentIntentId },
        'Stripe dispute could not be matched to a ScaleSafe contact — auto-prepare skipped (merchant can prepare manually)',
      );
      return null;
    }

    // Enrich the dispute row so the queue shows who it belongs to
    await supabase.from('dispute_events').update({
      contact_id: paymentEvent.contact_id,
      payment_event_id: paymentEvent.id,
    }).eq('id', disputeEvent.id);

    // Offer comes from the enrollment when we have one
    let offerId: string | undefined;
    if (paymentEvent.enrollment_id) {
      const { data: enr } = await supabase
        .from('enrollments')
        .select('offer_id')
        .eq('id', paymentEvent.enrollment_id)
        .eq('location_id', merchant.location_id)
        .eq('contact_id', paymentEvent.contact_id)
        .maybeSingle();
      offerId = enr?.offer_id || undefined;
    }

    // Prefer the card network's reason code (e.g. 10.4/13.1) over Stripe's
    // coarse reason string. An unrecognized code flows into the unknown-reason
    // needs_review gate downstream — never silently defaulted.
    const reasonCode = stripeDispute.payment_method_details?.card?.network_reason_code
      || stripeDispute.reason
      || 'unknown';

    const disputeDate = stripeDispute.created
      ? new Date(stripeDispute.created * 1000).toISOString()
      : new Date().toISOString();
    const deadline = disputeEvent.evidence_due_by
      || (stripeDispute.evidence_details?.due_by
        ? new Date(stripeDispute.evidence_details.due_by * 1000).toISOString()
        : new Date(Date.now() + 20 * 24 * 60 * 60 * 1000).toISOString());

    return this.compileDefense({
      locationId: merchant.location_id,
      contactId: paymentEvent.contact_id,
      offerId,
      reasonCode,
      disputeAmount: Number(disputeEvent.amount || (stripeDispute.amount || 0) / 100),
      disputeDate,
      deadline,
      caseNumber: stripeDispute.id,
      disputeEventId: disputeEvent.id,
      processor: 'stripe',
      paymentEventId: paymentEvent.id,
      enrollmentId: paymentEvent.enrollment_id || undefined,
    });
  },

  /**
   * Push a Stripe-rail packet's evidence to Stripe (Disputes API) with hard
   * safeguards. Throws on any gate failure — markSubmitted must NOT mark the
   * packet submitted locally when the Stripe push fails.
   *
   * Gates (SECURITY/INTEGRITY — do not relax):
   *  - idempotent: refuses when evidence was already submitted for the dispute
   *  - scope: refuses packets not linked to a specific enrollment (never
   *    submit contact-wide evidence to Stripe)
   *  - letter: refuses when the current letter is the automatic fallback draft
   */
  async submitPacketEvidenceToStripe(
    packet: any,
    disputeEvent: any,
    operation?: { idempotencyKey?: string; onBeforeProviderCall?: () => Promise<void> },
  ): Promise<void> {
    const supabase = getSupabase();
    const { stripeDisputeService } = require('./stripe-dispute.service');

    if (disputeEvent.evidence_submitted) {
      throw new ConflictError('Evidence for this dispute has already been submitted to Stripe.');
    }
    if (!packet.enrollment_id) {
      throw new ValidationError(
        'This packet is not linked to a specific program/transaction. ScaleSafe will not submit '
        + 'contact-wide evidence to Stripe — regenerate the packet with the disputed transaction selected.',
      );
    }
    const { data: latestVersion } = await supabase
      .from('defense_letter_versions')
      .select('generated_by')
      .eq('defense_packet_id', packet.id)
      .order('version_number', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (latestVersion?.generated_by === 'system') {
      throw new ValidationError('The current letter is the automatic fallback draft. Regenerate or edit the letter before submitting to Stripe.');
    }

    const merchant = await merchantRepository.getByLocationId(packet.location_id);
    if (!(merchant as any)?.stripe_user_id) {
      throw new ValidationError('No connected Stripe account for this merchant.');
    }

    // Baseline: vault-assembled evidence for this dispute (non-fatal if unavailable)
    let evidence: Record<string, any> = {};
    try {
      const assembled = await stripeDisputeService.assembleEvidencePacket(
        disputeEvent.stripe_dispute_id, (merchant as any).id,
      );
      evidence = { ...(assembled?.evidence || {}) };
    } catch (err: any) {
      logger.warn({ err: err?.message, defenseId: packet.id }, 'Vault evidence assembly failed; submitting packet-scoped evidence only');
    }

    // Packet-scoped fields take precedence over vault baseline
    const offer = await this.getOfferContext(packet.location_id, packet.offer_id);
    if (offer?.offerName || offer?.description) {
      evidence.product_description = [offer.offerName, offer.description].filter(Boolean).join(' — ').slice(0, 1500);
    }
    if (packet.defense_letter_text) {
      // Stripe caps combined text evidence at 150k chars — leave headroom for other fields.
      evidence.uncategorized_text = String(packet.defense_letter_text).slice(0, 100000);
    }
    try {
      const api = await ghlApi(packet.location_id);
      const contactRes = await api.get(`/contacts/${packet.contact_id}`);
      const contact = contactRes.data.contact || contactRes.data;
      if (contact?.email) evidence.customer_email_address = contact.email;
      const clientName = [contact?.firstName, contact?.lastName].filter(Boolean).join(' ');
      if (clientName) evidence.customer_name = clientName;
    } catch (err: any) {
      logger.warn({ err: err?.message, defenseId: packet.id }, 'Contact identity lookup failed for Stripe evidence');
    }
    try {
      const { data: enr } = await supabase
        .from('enrollments')
        .select('consent_captured_at, created_at')
        .eq('id', packet.enrollment_id)
        .eq('location_id', packet.location_id)
        .eq('contact_id', packet.contact_id)
        .maybeSingle();
      const serviceDate = enr?.consent_captured_at || enr?.created_at;
      if (serviceDate) evidence.service_date = String(serviceDate).slice(0, 10);
    } catch (err: any) {
      logger.warn({ err: err?.message, defenseId: packet.id }, 'Enrollment date lookup failed for Stripe evidence');
    }

    // Upload the bundled defense packet PDF (letter + exhibits). A failed
    // attachment must NOT block the submission — near a deadline, the letter
    // text + structured evidence reaching Stripe beats losing everything over
    // one attachment. Failures are logged with Stripe's full diagnostics and
    // recorded on the packet.
    let pdfAttachError: string | null = null;
    if (packet.pdf_storage_path) {
      try {
        const { buffer } = await storageService.downloadPrivateFileWithLegacy(packet.pdf_storage_path);
        const MAX_EVIDENCE_FILE_BYTES = 4.5 * 1024 * 1024;
        if (buffer.length > MAX_EVIDENCE_FILE_BYTES) {
          pdfAttachError = `Packet PDF is ${(buffer.length / 1024 / 1024).toFixed(1)}MB — over Stripe's ~4.5MB evidence limit; submitted without the PDF attachment. Reduce the exhibit count and rebundle.`;
        } else {
          const fileId = await stripeDisputeService.uploadDefensePacketFile({
            merchantStripeAccountId: (merchant as any).stripe_user_id,
            buffer,
            filename: `scalesafe-defense-packet-${packet.id}.pdf`,
          });
          evidence.uncategorized_file = fileId;

          const { error: fileRecordError } = await supabase.from('dispute_evidence_files').insert({
            dispute_event_id: disputeEvent.id,
            merchant_id: (merchant as any).id,
            stripe_file_id: fileId,
            file_purpose: 'dispute_evidence',
            file_type: 'defense_packet_pdf',
            description: `ScaleSafe defense packet ${packet.id} (letter + exhibits)`,
          });
          if (fileRecordError) {
            logger.warn({ err: fileRecordError.message, defenseId: packet.id }, 'Failed to record dispute evidence file (non-fatal)');
          }
        }
      } catch (err: any) {
        pdfAttachError = `Packet PDF upload to Stripe failed — evidence was submitted without the attachment. (${err?.message || err})`;
        logger.error(
          {
            defenseId: packet.id,
            err: err?.message,
            stripeErrorType: err?.type,
            stripeParam: err?.param,
            stripeRequestId: err?.requestId || err?.raw?.requestId,
          },
          'Defense packet PDF upload to Stripe FAILED — submitting evidence without the attachment',
        );
      }
    }
    if (pdfAttachError) {
      const { error: debugError } = await supabase
        .from('defense_packets')
        .update({ internal_debug: { ...((packet as any).internal_debug || {}), pdf_attach_error: pdfAttachError } })
        .eq('id', packet.id)
        .eq('location_id', packet.location_id);
      if (debugError) {
        logger.warn({ err: debugError.message, defenseId: packet.id }, 'Failed to record PDF attach error (non-fatal)');
      }
    }

    // Stripe FILE-type evidence fields only accept uploaded file ids — a raw
    // text value (e.g. a refund-policy string from the vault assembler) 400s
    // the ENTIRE submission. Drop anything that isn't a Stripe file id.
    const FILE_ONLY_EVIDENCE_FIELDS = [
      'cancellation_policy', 'customer_communication', 'customer_signature',
      'duplicate_charge_documentation', 'receipt', 'refund_policy',
      'service_documentation', 'shipping_documentation', 'uncategorized_file',
    ];
    for (const field of FILE_ONLY_EVIDENCE_FIELDS) {
      const value = evidence[field];
      if (value && typeof value === 'string' && !value.startsWith('file_')) {
        logger.warn({ defenseId: packet.id, field }, 'Dropped non-file value from file-only Stripe evidence field');
        delete evidence[field];
      }
    }

    // Visa CE 3.0: on eligible 10.4 fraud disputes, attach prior-transaction
    // proof from the same client. Standard evidence fields above stay populated
    // as the fallback (a not_qualified set still goes through normal review).
    try {
      const ce3Eligibility = stripeDisputeService.getCe3Eligibility(disputeEvent);
      if (ce3Eligibility.eligible) {
        const { stripeCe3Service } = require('./stripe-ce3.service');
        const ce3 = await stripeCe3Service.buildCe3Evidence({
          merchant,
          disputeEvent,
          productDescription: evidence.product_description || null,
        });
        if (ce3.evidence) {
          evidence.enhanced_evidence = { visa_compelling_evidence_3: ce3.evidence };
          logger.info({ defenseId: packet.id, stripeDisputeId: disputeEvent.stripe_dispute_id }, 'CE 3.0 enhanced evidence attached to submission');
        } else {
          logger.info({ defenseId: packet.id, reasons: ce3.reasons }, 'Dispute is CE 3.0 eligible but prior-transaction proof could not be assembled — submitting standard evidence');
          const { error: debugError } = await supabase
            .from('defense_packets')
            .update({ internal_debug: { ...((packet as any).internal_debug || {}), ce3_skipped_reasons: ce3.reasons } })
            .eq('id', packet.id)
            .eq('location_id', packet.location_id);
          if (debugError) {
            logger.warn({ err: debugError.message, defenseId: packet.id }, 'Failed to record CE 3.0 skip reasons (non-fatal)');
          }
        }
      }
    } catch (err: any) {
      logger.warn({ err: err?.message, defenseId: packet.id }, 'CE 3.0 evidence assembly failed (non-fatal) — submitting standard evidence');
    }

    try {
      if (operation?.onBeforeProviderCall) await operation.onBeforeProviderCall();
      await stripeDisputeService.submitEvidence({
        stripeDisputeId: disputeEvent.stripe_dispute_id,
        merchantId: (merchant as any).id,
        evidence,
        autoSubmit: true,
        submissionMode: 'manual',
        idempotencyKey: operation?.idempotencyKey,
      });
    } catch (err: any) {
      // Only our own typed errors pass through — raw Stripe errors also carry
      // a statusCode, so an instanceof check is required to avoid leaking them
      // as generic "unexpected error" responses.
      if (err instanceof AppError) throw err;
      const detail = [err?.message || String(err), err?.param ? `(param: ${err.param})` : '']
        .filter(Boolean).join(' ');
      throw new ExternalServiceError('Stripe', `Evidence submission failed — the packet was NOT marked submitted. ${detail}`);
    }

    logger.info(
      { defenseId: packet.id, stripeDisputeId: disputeEvent.stripe_dispute_id, fields: Object.keys(evidence).length },
      'Defense packet evidence submitted to Stripe',
    );
  },

  /**
   * Mark a defense packet as submitted. Locks the letter + PDF.
   * For Stripe-rail packets this ALSO pushes the evidence to Stripe first —
   * a failed Stripe push aborts (the packet stays pending_submission).
   */
  async markSubmitted(defenseId: string, locationId?: string): Promise<void> {
    const supabase = getSupabase();
    const packet = await defenseRepository.getById(defenseId, locationId);

    if ((packet as any).lifecycle_status !== 'pending_submission') {
      throw new Error(`Cannot submit a packet with status '${(packet as any).lifecycle_status}'`);
    }

    const latestVersion = await requireCurrentDefenseBundle(packet);

    let disputeEvent: any = null;
    if ((packet as any).dispute_event_id) {
      const { data, error } = await supabase
        .from('dispute_events')
        .select('*')
        .eq('id', (packet as any).dispute_event_id)
        .eq('location_id', packet.location_id)
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new ValidationError('The dispute linked to this defense packet could not be verified.');
      disputeEvent = data;
    }

    const claimResult = await defenseSubmissionService.begin({
      locationId: packet.location_id,
      defensePacketId: defenseId,
      disputeEventId: disputeEvent?.id || null,
      request: {
        defensePacketId: defenseId,
        disputeEventId: disputeEvent?.id || null,
        letterVersion: latestVersion.version_number,
        pdfStoragePath: packet.pdf_storage_path,
      },
    });
    if (claimResult.action === 'replay') return;
    if (claimResult.action === 'blocked') {
      throw new ConflictError(
        claimResult.claim.status === 'provider_accepted'
          ? 'The processor accepted this submission and ScaleSafe is reconciling the local record. Do not submit it again.'
          : 'This defense submission is already processing or has an unknown provider result. Review its status before trying again.',
      );
    }

    const claim = claimResult.claim;
    let providerStarted = false;
    let providerAccepted = false;
    try {
      if (disputeEvent?.stripe_dispute_id) {
        await this.submitPacketEvidenceToStripe(packet, disputeEvent, {
          idempotencyKey: `scalesafe-defense-${claim.id}`,
          onBeforeProviderCall: async () => {
            await defenseSubmissionService.markProviderStarted({
              claimId: claim.id,
              locationId: packet.location_id,
              providerReference: disputeEvent.stripe_dispute_id,
            });
            providerStarted = true;
          },
        });
        await defenseSubmissionService.markProviderAccepted({
          claimId: claim.id,
          locationId: packet.location_id,
          providerReference: disputeEvent.stripe_dispute_id,
          providerCalled: true,
        });
        providerAccepted = true;
      } else {
        await defenseSubmissionService.markProviderAccepted({
          claimId: claim.id,
          locationId: packet.location_id,
          providerReference: null,
          providerCalled: false,
        });
        providerAccepted = true;
      }

      await defenseSubmissionService.finalizeAccepted(claim.id, packet.location_id);
    } catch (err: any) {
      try {
        if (providerAccepted) {
          // Leave the durable claim at provider_accepted. The reconciliation
          // worker can safely retry only the local writes without re-submitting.
          logger.error({ err: err?.message, defenseId, claimId: claim.id }, 'Defense provider accepted submission but local finalization failed');
        } else if (providerStarted) {
          await defenseSubmissionService.markUnknown({
            claimId: claim.id,
            locationId: packet.location_id,
            error: err?.message || String(err),
          });
        } else {
          await defenseSubmissionService.markFailedBeforeProvider({
            claimId: claim.id,
            locationId: packet.location_id,
            error: err?.message || String(err),
          });
        }
      } catch (claimErr: any) {
        logger.error({ err: claimErr.message, defenseId, claimId: claim.id }, 'Failed to persist defense submission failure state');
      }
      throw err;
    }

    logger.info({ defenseId, claimId: claim.id }, 'Defense packet marked as submitted');
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
    const { data: maxRow, error: maxRowError } = await supabase
      .from('defense_letter_versions')
      .select('version_number')
      .eq('defense_packet_id', defenseId)
      .order('version_number', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (maxRowError) throw maxRowError;
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
      {
        paymentEventId: scope.paymentEventId,
        processorTransactionId: scope.processorTransactionId,
        onOrAfter: scope.transactionDate,
      },
    );
    let contactDetails: Record<string, unknown> = {};
    try {
      const api = await ghlApi(input.locationId);
      const contactRes = await api.get(`/contacts/${input.contactId}`);
      contactDetails = contactRes.data.contact || contactRes.data;
    } catch {}
    const merchant = await merchantRepository.getByLocationId(input.locationId);
    const offerContext = await this.getOfferContext(input.locationId, scope.offerId);

    const systemPrompt = this.buildSystemPrompt(category, strategy, template);
    const userMessage = this.buildUserMessage(input, contactDetails, merchant, exhibitList, undisputedPayments, category, scope, offerContext);
    // 16000: thinking tokens share this budget on adaptive-thinking models.
    const result = await callClaude(systemPrompt, userMessage, 16000);

    // Insert new version
    const { error: regenVersionErr } = await supabase.from('defense_letter_versions').insert({
      defense_packet_id: defenseId,
      version_number: nextVersion,
      letter_text: result.text,
      generated_by: 'ai',
      model_used: result.model || 'claude',
      prompt_tokens_used: result.inputTokens,
      response_tokens_used: result.outputTokens,
    });
    if (regenVersionErr) {
      logger.error({ err: regenVersionErr.message, defenseId }, 'Letter version insert FAILED — version history is missing this letter');
      throw regenVersionErr;
    }

    // A successful regeneration must re-evaluate the review state: a stale
    // "AI draft was unavailable" reason from the original compile must clear,
    // while reasons that still apply (scope, readiness, source errors) must
    // persist. Deliberately does NOT fire ss_defense_ready — the merchant is
    // already in the UI, and regeneration is not a new "packet ready" event.
    const readiness = defenseReadinessService.assess(category, exhibitList, scope, {
      amount: packet.chargeback_amount,
      date: packet.chargeback_date,
    });
    const { needsReview, reviewReasons } = evaluateReviewState({
      usedFallback: false,
      scope,
      unknownReasonCode: !resolveReasonCode(input.reasonCode),
      readiness,
      sourceErrors: exhibitList.sourceErrors || [],
      reasonCode: input.reasonCode,
    });
    const newStatus = needsReview ? 'needs_review' : 'complete';

    // Mirror to fast-read column with the freshly evaluated status
    await defenseRepository.updateStatus(defenseId, newStatus, {
      defense_letter_text: result.text,
      prompt_tokens_used: result.inputTokens,
      response_tokens_used: result.outputTokens,
      error_message: needsReview ? reviewReasons.join(' ') : null,
      enrollment_id: scope.enrollmentId || null,
      offer_id: scope.offerId || null,
      evidence_snapshot: {
        scope,
        exhibits: exhibitList.exhibits,
        sourceErrors: exhibitList.sourceErrors || [],
        capturedAt: new Date().toISOString(),
      },
      evidence_count: exhibitList.exhibits.length,
      pdf_storage_path: null,
      pdf_url: null,
    } as any);

    // Rebundle PDF. The old path was cleared above, so a failure cannot leave
    // the new letter paired with a stale downloadable PDF.
    try {
      const { defenseBundleService } = require('./defense-bundle.service');
      await defenseBundleService.bundleDefensePdf(defenseId, input.locationId, input.contactId, exhibitScope);
    } catch (err: any) {
      await defenseRepository.updateStatus(defenseId, 'needs_review', {
        pdf_storage_path: null,
        pdf_url: null,
        error_message: `The letter was regenerated, but the defense PDF could not be rebuilt: ${err.message}`,
      } as any);
      throw new Error(`Letter regenerated, but the defense PDF could not be rebuilt: ${err.message}`);
    }

    logger.info({ defenseId, version: nextVersion, status: newStatus }, 'Defense letter regenerated');
    return { letterText: result.text, versionNumber: nextVersion };
  },

  /**
   * Correct the response deadline. Only available before submission — the
   * stored default may come from an optimistic network window, and the
   * merchant is the one who knows the processor's actual due date.
   */
  async updateDeadline(defenseId: string, deadline: string, locationId?: string): Promise<void> {
    const packet = await defenseRepository.getById(defenseId, locationId);
    if ((packet as any).lifecycle_status !== 'pending_submission') {
      throw new Error('Cannot change the deadline after submission');
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(deadline) || Number.isNaN(new Date(deadline).getTime())) {
      throw new Error('deadline must be a valid date in YYYY-MM-DD format');
    }
    const supabase = getSupabase();
    const { error } = await supabase
      .from('defense_packets')
      .update({ response_deadline: deadline })
      .eq('id', defenseId)
      .eq('location_id', packet.location_id);
    if (error) throw error;
    logger.info({ defenseId, deadline }, 'Defense packet response deadline updated by merchant');
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

    const { data: maxRow, error: maxRowError } = await supabase
      .from('defense_letter_versions')
      .select('version_number')
      .eq('defense_packet_id', defenseId)
      .order('version_number', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (maxRowError) throw maxRowError;
    const nextVersion = (maxRow?.version_number || 0) + 1;

    const { error: versionInsertError } = await supabase.from('defense_letter_versions').insert({
      defense_packet_id: defenseId,
      version_number: nextVersion,
      letter_text: letterText,
      generated_by: 'manual_edit',
    });
    if (versionInsertError) throw versionInsertError;

    // Mirror to the fast-read column and invalidate the old bundle atomically.
    await defenseRepository.updateStatus(defenseId, packet.status || 'needs_review', {
      defense_letter_text: letterText,
      pdf_storage_path: null,
      pdf_url: null,
    } as any);

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
    } catch (err: any) {
      await defenseRepository.updateStatus(defenseId, 'needs_review', {
        pdf_storage_path: null,
        pdf_url: null,
        error_message: `The letter was saved, but the defense PDF could not be rebuilt: ${err.message}`,
      } as any);
      throw new Error(`Letter saved, but the defense PDF could not be rebuilt: ${err.message}`);
    }

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
