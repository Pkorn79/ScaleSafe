/**
 * defense.service.ts — AI Defense Compilation Service
 *
 * The core differentiator of ScaleSafe. When a chargeback is filed,
 * this service:
 *
 * 1. Creates a defense_packets record (status: pending)
 * 2. Fetches ALL evidence for the contact from Supabase
 * 3. Fetches contact details from GHL (name, program, enrollment date)
 * 4. Builds a structured 12-section prompt (matching S11's proven format)
 * 5. Calls Claude API to generate a professional defense letter
 * 6. Generates a PDF via pdf.service (defense letter + evidence appendix)
 * 7. Stores the PDF in Supabase Storage
 * 8. Updates the defense_packets record (status: complete)
 * 9. Updates the contact's defense fields in GHL
 *
 * Replaces Make.com S11 (AI Defense Compiler).
 * No timeout risk — Make.com had a 40s limit; Node.js has none.
 */

import { GhlClient } from '../clients/ghl.client';
import { tokenStore, findByLocationId } from '../repositories/merchant.repository';
import * as defenseRepo from '../repositories/defense.repository';
import * as evidenceService from './evidence.service';
import * as pdfService from './pdf.service';
import { generateDefenseLetter } from '../clients/anthropic.client';
import {
  SS_DEFENSE_PACKET_URL, SS_DEFENSE_PDF_URL, SS_LAST_DEFENSE_DATE,
} from '../constants/ghl-contact-fields';
import { logger } from '../utils/logger';
import { NotFoundError } from '../utils/errors';

const ghlClient = new GhlClient(tokenStore);

/** Chargeback details passed when triggering a defense compilation. */
export interface ChargebackData {
  reasonCode?: string;
  amount?: number;
  date?: string;
  triggeredBy?: string; // 'manual' | 'chargeback_webhook' | 'api'
}

/**
 * Triggers a full defense compilation for a contact.
 * This is an async operation — creates the packet in "pending" status
 * and returns immediately. The actual compilation runs in the background.
 *
 * In Phase 5, this will be moved to a BullMQ queue worker.
 */
export async function compile(
  locationId: string,
  contactId: string,
  chargebackData: ChargebackData
): Promise<{ defenseId: string; status: string }> {
  // Create the defense packet record
  const packet = await defenseRepo.create(locationId, contactId, chargebackData);

  logger.info(
    { defenseId: packet.id, locationId, contactId },
    'Defense compilation started'
  );

  // Run the compilation (in the future, this will be a queued job)
  // Using setImmediate so we return the defenseId immediately
  setImmediate(() => {
    runCompilation(packet.id, locationId, contactId, chargebackData).catch((err) => {
      logger.error({ err, defenseId: packet.id }, 'Defense compilation failed');
    });
  });

  return { defenseId: packet.id, status: 'pending' };
}

/**
 * The actual compilation pipeline. Runs asynchronously after the HTTP response.
 */
async function runCompilation(
  defenseId: string,
  locationId: string,
  contactId: string,
  chargebackData: ChargebackData
): Promise<void> {
  try {
    // Mark as processing
    await defenseRepo.update(defenseId, { status: 'processing' });

    // 1. Get merchant info
    const merchant = await findByLocationId(locationId);
    if (!merchant) throw new NotFoundError('Merchant not found');

    // 2. Get contact info from GHL
    const client = await ghlClient.getAuthenticatedClient(locationId);
    const contactRes = await client.get(`/contacts/${contactId}`, {
      headers: { Version: '2021-07-28' },
    });
    const contact = contactRes.data?.contact || contactRes.data;
    const contactName = `${contact?.firstName || ''} ${contact?.lastName || ''}`.trim() || 'Client';
    const customFields = contact?.customFields || {};
    const programName = customFields['contact.offer_program_name'] || 'Coaching Program';

    // 3. Fetch ALL evidence
    const evidence = await evidenceService.getAllForContact(locationId, contactId);

    // 4. Snapshot the evidence (frozen at compilation time)
    await defenseRepo.update(defenseId, {
      evidence_snapshot: { evidence, contact: { name: contactName, programName } } as any,
      evidence_count: evidence.length,
    });

    // 5. Build the prompt and call Claude
    const systemPrompt = buildSystemPrompt();
    const userPrompt = buildUserPrompt(
      merchant.business_name || 'Merchant',
      contactName,
      programName,
      chargebackData,
      evidence,
      customFields
    );

    const aiResult = await generateDefenseLetter(systemPrompt, userPrompt);

    // 6. Generate PDF
    const pdfResult = await pdfService.generateDefensePacket({
      defenseId,
      merchantName: merchant.business_name || 'Merchant',
      merchantEmail: merchant.support_email || '',
      contactName,
      programName,
      chargebackAmount: chargebackData.amount || 0,
      chargebackDate: chargebackData.date || new Date().toISOString().split('T')[0],
      chargebackReasonCode: chargebackData.reasonCode || 'Unknown',
      defenseLetter: aiResult.text,
      evidence,
      generatedAt: new Date().toISOString(),
    });

    // 7. Update the defense packet as complete
    await defenseRepo.update(defenseId, {
      status: 'complete',
      defense_letter_text: aiResult.text,
      prompt_tokens_used: aiResult.inputTokens,
      response_tokens_used: aiResult.outputTokens,
      pdf_storage_path: pdfResult.storagePath,
      pdf_url: pdfResult.url,
      completed_at: new Date().toISOString(),
    });

    // 8. Update contact defense fields in GHL
    try {
      await client.put(
        `/contacts/${contactId}`,
        {
          customFields: {
            [SS_DEFENSE_PACKET_URL.key]: pdfResult.url,
            [SS_DEFENSE_PDF_URL.key]: pdfResult.url,
            [SS_LAST_DEFENSE_DATE.key]: new Date().toISOString().split('T')[0],
          },
        },
        { headers: { Version: '2021-07-28' } }
      );
    } catch (err) {
      logger.error({ err, contactId }, 'Failed to update contact defense fields');
    }

    logger.info(
      {
        defenseId,
        contactId,
        evidenceCount: evidence.length,
        inputTokens: aiResult.inputTokens,
        outputTokens: aiResult.outputTokens,
      },
      'Defense compilation complete'
    );
  } catch (error: any) {
    // Mark as failed with error message
    await defenseRepo.update(defenseId, {
      status: 'failed',
      error_message: error.message || 'Unknown error',
      completed_at: new Date().toISOString(),
    });
    throw error;
  }
}

/** Gets the current status of a defense compilation. */
export async function getStatus(defenseId: string) {
  const packet = await defenseRepo.findById(defenseId);
  if (!packet) throw new NotFoundError('Defense packet not found');
  return {
    id: packet.id,
    status: packet.status,
    triggeredAt: packet.triggered_at,
    completedAt: packet.completed_at,
    evidenceCount: packet.evidence_count,
    errorMessage: packet.error_message,
    pdfUrl: packet.pdf_url,
  };
}

/** Gets the full defense packet including the letter text and PDF URL. */
export async function getPacket(defenseId: string) {
  const packet = await defenseRepo.findById(defenseId);
  if (!packet) throw new NotFoundError('Defense packet not found');
  return packet;
}

/** Lists all defense packets for a contact. */
export async function listForContact(locationId: string, contactId: string) {
  return defenseRepo.findByContact(locationId, contactId);
}

// ============================================
// PROMPT BUILDING (12-section structure matching S11)
// ============================================

/** System prompt that sets Claude's role as a chargeback defense specialist. */
function buildSystemPrompt(): string {
  return `You are an expert chargeback defense specialist. Your job is to write professional, persuasive chargeback defense letters for coaching businesses.

Your letters must:
- Be addressed to the acquiring bank / payment processor
- Reference specific evidence with exact dates and amounts
- Argue why the charge was legitimate and the service was delivered
- Follow the standard chargeback rebuttal format
- Be factual, professional, and thorough
- Cite the specific chargeback reason code and address it directly
- Include a summary of all evidence categories available

Do NOT fabricate evidence. Only reference data that is explicitly provided in the evidence summary.
Write in a formal but clear tone. The letter should be ready to submit as-is.`;
}

/** Builds the user prompt with all evidence and context. */
function buildUserPrompt(
  merchantName: string,
  contactName: string,
  programName: string,
  chargebackData: ChargebackData,
  evidence: Record<string, unknown>[],
  customFields: Record<string, unknown>
): string {
  // Organize evidence by type
  const byType: Record<string, Record<string, unknown>[]> = {};
  for (const e of evidence) {
    const type = (e.type as string) || 'other';
    if (!byType[type]) byType[type] = [];
    byType[type].push(e);
  }

  let prompt = `Write a chargeback defense letter for the following case:\n\n`;

  // Section 1: Merchant info
  prompt += `## 1. MERCHANT INFORMATION\n`;
  prompt += `- Business Name: ${merchantName}\n`;
  prompt += `- Program: ${programName}\n\n`;

  // Section 2: Client info
  prompt += `## 2. CLIENT INFORMATION\n`;
  prompt += `- Client Name: ${contactName}\n`;
  prompt += `- Enrollment Date: ${customFields['contact.ss_subscription_start'] || 'On file'}\n`;
  prompt += `- Payment Type: ${customFields['contact.offer_payment_type'] || 'On file'}\n\n`;

  // Section 3: Chargeback details
  prompt += `## 3. CHARGEBACK DETAILS\n`;
  prompt += `- Reason Code: ${chargebackData.reasonCode || 'Not specified'}\n`;
  prompt += `- Disputed Amount: $${chargebackData.amount || 0}\n`;
  prompt += `- Chargeback Date: ${chargebackData.date || 'Not specified'}\n\n`;

  // Section 4: T&C Consent
  prompt += `## 4. TERMS & CONDITIONS CONSENT\n`;
  const tcAccepted = customFields['contact.ss_tc_accepted'];
  const tcDate = customFields['contact.ss_tc_accepted_date'];
  const tcIp = customFields['contact.ss_tc_ip_address'];
  if (tcAccepted) {
    prompt += `- T&C Accepted: Yes\n`;
    prompt += `- Acceptance Date: ${tcDate}\n`;
    prompt += `- Client IP: ${tcIp}\n`;
    prompt += `- Clauses Accepted: ${customFields['contact.ss_tc_clauses_accepted'] || 'All'}\n\n`;
  } else {
    prompt += `- No T&C consent record available\n\n`;
  }

  // Section 5: Payment history
  prompt += `## 5. PAYMENT HISTORY\n`;
  const payments = byType['payment'] || [];
  prompt += `- Total payments on file: ${payments.length}\n`;
  prompt += `- Total paid: ${customFields['contact.ss_total_paid'] || 'On file'}\n`;
  for (const p of payments.slice(0, 20)) {
    prompt += `  - ${(p as any).created_at}: $${(p as any).amount || (p as any).data?.amount || 'N/A'}\n`;
  }
  prompt += `\n`;

  // Section 6: Session delivery
  prompt += `## 6. SESSION DELIVERY EVIDENCE\n`;
  const sessions = byType['session'] || [];
  prompt += `- Total sessions logged: ${sessions.length}\n`;
  for (const s of sessions.slice(0, 20)) {
    prompt += `  - ${(s as any).created_at}: ${JSON.stringify((s as any).data || s).substring(0, 150)}\n`;
  }
  prompt += `\n`;

  // Section 7: Module/course progress
  prompt += `## 7. COURSE/MODULE PROGRESS\n`;
  const modules = byType['module'] || [];
  prompt += `- Modules completed: ${modules.length}\n`;
  for (const m of modules.slice(0, 20)) {
    prompt += `  - ${(m as any).created_at}: ${JSON.stringify((m as any).data || m).substring(0, 150)}\n`;
  }
  prompt += `\n`;

  // Section 8: Milestone progress
  prompt += `## 8. MILESTONE PROGRESS\n`;
  const milestones = byType['milestone'] || [];
  prompt += `- Milestones signed off: ${milestones.length}\n`;
  for (const ms of milestones) {
    prompt += `  - ${(ms as any).created_at}: ${JSON.stringify((ms as any).data || ms).substring(0, 150)}\n`;
  }
  prompt += `\n`;

  // Section 9: Client engagement (pulse checks)
  prompt += `## 9. CLIENT SATISFACTION / ENGAGEMENT\n`;
  const pulses = byType['pulse'] || [];
  prompt += `- Pulse check records: ${pulses.length}\n`;
  for (const p of pulses) {
    prompt += `  - ${(p as any).created_at}: ${JSON.stringify((p as any).data || p).substring(0, 150)}\n`;
  }
  prompt += `\n`;

  // Section 10: Enrollment evidence
  prompt += `## 10. ENROLLMENT EVIDENCE\n`;
  const enrollment = byType['enrollment'] || [];
  prompt += `- Enrollment records: ${enrollment.length}\n`;
  for (const e of enrollment) {
    prompt += `  - ${(e as any).created_at}: ${JSON.stringify((e as any).data || e).substring(0, 200)}\n`;
  }
  prompt += `\n`;

  // Section 11: No-shows (if any — actually helps our case if minimal)
  prompt += `## 11. ATTENDANCE RECORD\n`;
  const noshows = byType['noshow'] || [];
  prompt += `- No-show records: ${noshows.length}\n`;
  if (noshows.length === 0) {
    prompt += `- Client had no recorded missed sessions.\n`;
  }
  prompt += `\n`;

  // Section 12: Service access
  prompt += `## 12. DIGITAL PLATFORM ACCESS\n`;
  const access = byType['service_access'] || [];
  prompt += `- Platform access records: ${access.length}\n`;
  for (const a of access.slice(0, 10)) {
    prompt += `  - ${(a as any).created_at}: ${JSON.stringify((a as any).data || a).substring(0, 150)}\n`;
  }
  prompt += `\n`;

  // Summary
  prompt += `## TOTAL EVIDENCE: ${evidence.length} records across ${Object.keys(byType).length} categories\n\n`;
  prompt += `Please write a comprehensive defense letter addressing the chargeback reason code and citing the specific evidence above. The letter should be ready to submit to the acquiring bank.`;

  return prompt;
}
