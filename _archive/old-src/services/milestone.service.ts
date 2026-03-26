/**
 * milestone.service.ts — Milestone Sign-Off Service
 *
 * Handles the milestone sign-off flow where clients acknowledge completing
 * a program milestone. This is powerful chargeback evidence — the client
 * explicitly confirms "yes, I completed this milestone."
 *
 * Flow:
 * 1. Coach delivers a milestone → triggers sign-off request
 * 2. Client receives a link to the sign-off page
 * 3. Client reviews the milestone summary and signs off (clickwrap)
 * 4. Sign-off logged as evidence, pipeline stage advanced
 *
 * Replaces the Make.com Milestone Sign-Off Page + S8 Route 10.
 */

import { GhlClient } from '../clients/ghl.client';
import { tokenStore } from '../repositories/merchant.repository';
import * as evidenceService from './evidence.service';
import {
  SS_SIGNOFF_MILESTONE_NUMBER, SS_SIGNOFF_MILESTONE_NAME,
  SS_SIGNOFF_WORK_SUMMARY, SS_CURRENT_MILESTONE_NAME,
  OFFER_MILESTONE_FIELDS,
} from '../constants/ghl-contact-fields';
import { EVIDENCE_TABLES } from '../constants/evidence-types';
import { logger } from '../utils/logger';
import { BadRequestError, NotFoundError } from '../utils/errors';

const ghlClient = new GhlClient(tokenStore);

/** Data needed to render the sign-off page. */
export interface SignOffPageData {
  contactId: string;
  contactName: string;
  programName: string;
  milestoneNumber: number;
  milestoneName: string;
  milestoneDelivers: string;
  milestoneClientDoes: string;
  merchantName: string;
}

/** Client's sign-off submission. */
export interface SignOffSubmission {
  locationId: string;
  contactId: string;
  milestoneNumber: number;
  milestoneName: string;
  workSummary: string;
  clientSigned: boolean;
  clientIp: string;
  consentText: string;
}

/**
 * Fetches the data needed to render a milestone sign-off page for a client.
 * Reads the contact's current milestone info from GHL.
 */
export async function getSignOffPageData(
  locationId: string,
  contactId: string
): Promise<SignOffPageData> {
  const client = await ghlClient.getAuthenticatedClient(locationId);

  const response = await client.get(`/contacts/${contactId}`, {
    headers: { Version: '2021-07-28' },
  });

  const contact = response.data?.contact || response.data;
  if (!contact) {
    throw new NotFoundError(`Contact not found: ${contactId}`);
  }

  const customFields = contact.customFields || contact.customField || {};

  // Determine current milestone number (default to 1)
  const currentMilestoneNumber = parseInt(
    customFields[SS_SIGNOFF_MILESTONE_NUMBER.key] || '1',
    10
  );
  const milestoneIndex = Math.min(currentMilestoneNumber - 1, 7); // 0-indexed, max 8

  const milestoneDef = OFFER_MILESTONE_FIELDS[milestoneIndex];

  return {
    contactId,
    contactName: `${contact.firstName || ''} ${contact.lastName || ''}`.trim(),
    programName: customFields['contact.offer_program_name'] || 'Program',
    milestoneNumber: currentMilestoneNumber,
    milestoneName: customFields[milestoneDef?.name.key] || `Milestone ${currentMilestoneNumber}`,
    milestoneDelivers: customFields[milestoneDef?.delivers.key] || '',
    milestoneClientDoes: customFields[milestoneDef?.clientDoes.key] || '',
    merchantName: customFields['contact.offer_business_name'] || '',
  };
}

/**
 * Processes a milestone sign-off submission from the client.
 * Logs evidence, updates contact fields, and advances the pipeline stage.
 */
export async function handleSignOff(submission: SignOffSubmission): Promise<void> {
  const { locationId, contactId, milestoneNumber, milestoneName, workSummary, clientSigned, clientIp, consentText } = submission;

  if (!clientSigned) {
    throw new BadRequestError('Client must acknowledge the milestone to submit sign-off');
  }

  // Log sign-off evidence
  await evidenceService.logFromForm(locationId, 'SYS2-06', {
    contact_id: contactId,
    milestone_number: milestoneNumber,
    milestone_name: milestoneName,
    work_summary: workSummary,
    client_signed: true,
    client_ip: clientIp,
    consent_text: consentText,
  });

  // Update sign-off tracking fields on the contact
  const client = await ghlClient.getAuthenticatedClient(locationId);
  await client.put(
    `/contacts/${contactId}`,
    {
      customFields: {
        [SS_SIGNOFF_MILESTONE_NUMBER.key]: String(milestoneNumber),
        [SS_SIGNOFF_MILESTONE_NAME.key]: milestoneName,
        [SS_SIGNOFF_WORK_SUMMARY.key]: workSummary,
        [SS_CURRENT_MILESTONE_NAME.key]: milestoneName,
      },
    },
    { headers: { Version: '2021-07-28' } }
  );

  // Advance pipeline stage (move opportunity to next milestone)
  // The pipeline stage IDs would need to be looked up dynamically.
  // For now, log that it should be advanced — Phase 5 will add full pipeline management.
  logger.info(
    { locationId, contactId, milestoneNumber, milestoneName },
    'Milestone signed off — evidence logged, fields updated. Pipeline advance pending.'
  );
}
