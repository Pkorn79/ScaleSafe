import { callClaude } from '../clients/anthropic.client';
import { ghlApi } from '../clients/ghl.client';
import { defenseRepository } from '../repositories/defense.repository';
import { evidenceRepository } from '../repositories/evidence.repository';
import { merchantRepository } from '../repositories/merchant.repository';
import { paymentService } from './payment.service';
import { notificationService } from './notification.service';
import { logger } from '../utils/logger';
import { SS_CONTACT_FIELDS } from '../constants/ghl-fields';

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
}

export const defenseService = {
  /**
   * Trigger defense compilation. Returns defenseId immediately.
   * Compilation runs asynchronously in the background.
   */
  async compileDefense(input: CompileDefenseInput): Promise<string> {
    const category = REASON_CODE_CATEGORIES[input.reasonCode] || 'services_not_provided';

    // Create pending defense packet
    const packet = await defenseRepository.create({
      location_id: input.locationId,
      contact_id: input.contactId,
      offer_id: input.offerId,
      reason_code: input.reasonCode,
      reason_category: category,
      dispute_amount: input.disputeAmount,
      dispute_date: input.disputeDate,
      deadline: input.deadline,
      case_number: input.caseNumber,
    });

    // Fire chargeback detected notification
    notificationService.fireChargebackDetected(input.locationId, input.contactId, {
      amount: input.disputeAmount,
      reasonCode: input.reasonCode,
      disputeDate: input.disputeDate,
      caseNumber: input.caseNumber,
    });

    // Update GHL contact
    try {
      const api = await ghlApi(input.locationId);
      await api.put(`/contacts/${input.contactId}`, {
        customField: {
          [SS_CONTACT_FIELDS.CHARGEBACK_STATUS]: 'disputed',
          [SS_CONTACT_FIELDS.DEFENSE_STATUS]: 'preparing',
        },
      });
    } catch (err) {
      logger.warn({ err, contactId: input.contactId }, 'Failed to update chargeback status');
    }

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

    // 1. Gather all evidence
    const evidence = await evidenceRepository.getFullSnapshot(input.locationId, input.contactId);
    await defenseRepository.updateStatus(defenseId, 'processing', {
      evidence_snapshot: evidence,
    } as any);

    // 2. Get undisputed payments (critical for defense)
    const undisputedPayments = await paymentService.getUndisputedPayments(input.locationId, input.contactId);

    // 3. Get contact details from GHL
    let contactDetails: Record<string, unknown> = {};
    try {
      const api = await ghlApi(input.locationId);
      const contactRes = await api.get(`/contacts/${input.contactId}`);
      contactDetails = contactRes.data.contact || contactRes.data;
    } catch (err) {
      logger.warn({ err, contactId: input.contactId }, 'Failed to fetch contact details');
    }

    // 4. Get merchant info
    const merchant = await merchantRepository.getByLocationId(input.locationId);

    // 5. Look up reason code strategy
    const strategy = await defenseRepository.getReasonCodeStrategy(input.reasonCode);

    // 6. Look up defense template
    const template = await defenseRepository.getDefenseTemplate(category);

    // 7. Build the AI prompt
    const systemPrompt = this.buildSystemPrompt(category, strategy, template);
    const userMessage = this.buildUserMessage(
      input, contactDetails, merchant, evidence, undisputedPayments, category,
    );

    // 8. Call Claude API
    const result = await callClaude(systemPrompt, userMessage, 8192);

    // 9. Update packet with result
    await defenseRepository.updateStatus(defenseId, 'complete', {
      defense_letter_text: result.text,
      input_tokens: result.inputTokens,
      output_tokens: result.outputTokens,
      template_id: template?.id || null,
    } as any);

    // 10. Update GHL contact
    try {
      const api = await ghlApi(input.locationId);
      await api.put(`/contacts/${input.contactId}`, {
        customField: {
          [SS_CONTACT_FIELDS.DEFENSE_STATUS]: 'ready',
        },
      });
    } catch (err) {
      logger.warn({ err }, 'Failed to update defense status on contact');
    }

    // 11. Fire defense ready notification
    await notificationService.fireDefenseReady(input.locationId, input.contactId, {
      packetUrl: '', // Will be set once PDF is generated
      deadline: input.deadline,
      evidenceCount: evidence.length,
    });

    logger.info({
      defenseId,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      evidenceCount: evidence.length,
    }, 'Defense compilation complete');
  },

  buildSystemPrompt(category: string, strategy: any, template: any): string {
    const categoryDescriptions: Record<string, string> = {
      fraud: 'The cardholder claims they did not authorize this transaction. Prove the same person enrolled and used the service by linking IP addresses, device fingerprints, and usage patterns.',
      services_not_provided: 'The cardholder claims services were not provided. Itemize every touchpoint with dates, session records, module completions, milestone sign-offs, and platform access logs.',
      not_as_described: 'The cardholder claims the service was not as described. Compare the offer terms presented at enrollment against what was actually delivered. Show the client reviewed and agreed to terms.',
      credit_not_processed: 'The cardholder claims a credit/refund was promised but not received. Show the refund policy agreed to at enrollment, communication logs, and any refund actions taken.',
      authorization: 'The cardholder disputes authorization. Focus on consent proof: T&C acceptance with timestamp, IP, device fingerprint, and digital signature.',
    };

    let prompt = `You are a chargeback defense specialist. Generate a professional defense letter for a ${category.replace(/_/g, ' ')} dispute.\n\n`;
    prompt += `DISPUTE CATEGORY: ${category}\n`;
    prompt += `STRATEGY: ${categoryDescriptions[category] || 'Present all available evidence of service delivery and client engagement.'}\n\n`;

    if (strategy) {
      prompt += `EVIDENCE PRIORITIES FOR THIS REASON CODE:\n${JSON.stringify(strategy.evidence_priorities, null, 2)}\n\n`;
    }

    if (template) {
      prompt += `USE THIS TEMPLATE STRUCTURE:\n${template.template_text}\n\n`;
    }

    prompt += `RULES:\n`;
    prompt += `- Be factual and precise. Use specific dates, amounts, and counts.\n`;
    prompt += `- Reference evidence by type and date.\n`;
    prompt += `- Include a "Prior Undisputed Transactions" section listing all successful payments NOT disputed.\n`;
    prompt += `- Use professional but assertive tone.\n`;
    prompt += `- Format with clear headers and sections.\n`;
    prompt += `- Do not fabricate evidence. Only reference what is provided.\n`;

    return prompt;
  },

  buildUserMessage(
    input: CompileDefenseInput,
    contact: Record<string, unknown>,
    merchant: any,
    evidence: any[],
    undisputedPayments: any[],
    category: string,
  ): string {
    let msg = `DISPUTE DETAILS:\n`;
    msg += `- Reason Code: ${input.reasonCode}\n`;
    msg += `- Amount: $${input.disputeAmount}\n`;
    msg += `- Dispute Date: ${input.disputeDate}\n`;
    msg += `- Deadline: ${input.deadline}\n`;
    if (input.caseNumber) msg += `- Case/ARN: ${input.caseNumber}\n`;
    msg += `\n`;

    msg += `MERCHANT:\n`;
    msg += `- Business: ${merchant.business_name || 'N/A'}\n`;
    msg += `\n`;

    msg += `CLIENT:\n`;
    msg += `- Name: ${contact.firstName || ''} ${contact.lastName || ''}\n`;
    msg += `- Email: ${contact.email || ''}\n`;
    msg += `\n`;

    msg += `EVIDENCE TIMELINE (${evidence.length} records):\n`;
    for (const e of evidence) {
      msg += `  [${e.event_date || e.created_at}] ${e.evidence_type}: ${JSON.stringify(e.summary || e.details || {})}\n`;
    }
    msg += `\n`;

    msg += `PRIOR UNDISPUTED TRANSACTIONS (${undisputedPayments.length}):\n`;
    for (const p of undisputedPayments) {
      msg += `  - ${p.payment_date || p.created_at}: $${p.amount}\n`;
    }
    msg += `\n`;

    msg += `Generate the defense letter now.`;

    return msg;
  },

  async getStatus(defenseId: string) {
    const packet = await defenseRepository.getById(defenseId);
    return {
      id: packet.id,
      status: packet.status,
      reasonCode: packet.reason_code,
      category: packet.reason_category,
      createdAt: packet.created_at,
      hasLetter: !!packet.defense_letter_text,
      hasPdf: !!packet.bundled_pdf_url,
    };
  },

  async getPacket(defenseId: string) {
    return defenseRepository.getById(defenseId);
  },

  async listForContact(locationId: string, contactId: string) {
    return defenseRepository.listByContact(locationId, contactId);
  },

  async recordOutcome(defenseId: string, outcome: 'won' | 'lost', notes?: string) {
    const packet = await defenseRepository.getById(defenseId);
    await defenseRepository.recordOutcome(defenseId, outcome, packet.dispute_amount || 0, notes);

    // Update GHL contact chargeback status
    const newStatus = outcome === 'won' ? 'won' : 'lost';
    try {
      const api = await ghlApi(packet.location_id);
      await api.put(`/contacts/${packet.contact_id}`, {
        customField: {
          [SS_CONTACT_FIELDS.CHARGEBACK_STATUS]: newStatus,
        },
      });
    } catch (err) {
      logger.warn({ err, defenseId }, 'Failed to update chargeback outcome on contact');
    }

    logger.info({ defenseId, outcome, amount: packet.dispute_amount }, 'Defense outcome recorded');
  },
};
