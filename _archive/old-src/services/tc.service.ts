/**
 * tc.service.ts — Terms & Conditions Compilation Service
 *
 * Handles the T&C clause system that is legally critical for chargeback defense.
 * Each offer has 11 clause slots (9 standard + 2 custom). This service:
 *
 * 1. Compiles clause slots into clickwrap HTML at offer creation time
 * 2. Validates consent data at enrollment time (timestamp, IP, user agent)
 *
 * The compiled HTML is stored on the offer as compiled_tc_html and shown
 * to clients on Page 3 of the enrollment funnel. Their acceptance is
 * timestamped, IP-logged, and stored as evidence — one of the strongest
 * pieces of evidence in a chargeback defense.
 */

import { STANDARD_CLAUSES } from '../constants/tc-clauses';
import { logger } from '../utils/logger';
import { BadRequestError } from '../utils/errors';

/** A single clause slot from an offer. */
interface ClauseSlot {
  title: string | null;
  text: string | null;
}

/** Consent data submitted by the client at enrollment. */
export interface ConsentData {
  tc_accepted: boolean;
  tc_accepted_date: string;
  tc_ip_address: string;
  tc_user_agent: string;
  clauses_accepted: string;
  consent_version?: string;
  digital_signature?: string;
}

/**
 * Compiles an offer's clause slots into formatted clickwrap HTML.
 * Takes the 11 clause slots from the offer and produces an HTML string
 * that can be displayed on the enrollment consent page.
 */
export function compileClausesHtml(
  clauseSlots: ClauseSlot[],
  offerName: string,
  merchantName: string
): string {
  const activeClasses: { title: string; text: string }[] = [];

  for (const slot of clauseSlots) {
    if (slot.title && slot.text) {
      activeClasses.push({ title: slot.title, text: slot.text });
    }
  }

  if (activeClasses.length === 0) {
    logger.warn({ offerName }, 'Offer has no active T&C clauses');
    return '<p>No terms and conditions configured for this offer.</p>';
  }

  // Build the HTML
  let html = `<div class="ss-tc-container">\n`;
  html += `  <h3>Terms &amp; Conditions</h3>\n`;
  html += `  <p class="ss-tc-intro">By enrolling in <strong>${escapeHtml(offerName)}</strong> offered by <strong>${escapeHtml(merchantName)}</strong>, you agree to the following terms:</p>\n`;

  for (let i = 0; i < activeClasses.length; i++) {
    const clause = activeClasses[i];
    html += `  <div class="ss-tc-clause">\n`;
    html += `    <h4>${i + 1}. ${escapeHtml(clause.title)}</h4>\n`;
    html += `    <p>${escapeHtml(clause.text)}</p>\n`;
    html += `  </div>\n`;
  }

  html += `</div>`;
  return html;
}

/**
 * Returns the 9 standard clause definitions.
 * Used by the offer builder UI to show available clauses.
 */
export function getStandardClauses() {
  return STANDARD_CLAUSES;
}

/**
 * Validates consent data from the enrollment page.
 * Ensures all required fields are present and the timestamp is valid.
 */
export function validateConsent(consent: ConsentData): void {
  if (!consent.tc_accepted) {
    throw new BadRequestError('Client must accept terms and conditions');
  }

  if (!consent.tc_accepted_date) {
    throw new BadRequestError('Missing T&C acceptance timestamp');
  }

  if (!consent.tc_ip_address) {
    throw new BadRequestError('Missing client IP address for T&C consent');
  }

  if (!consent.tc_user_agent) {
    throw new BadRequestError('Missing client user agent for T&C consent');
  }

  // Validate the timestamp is a valid ISO date
  const date = new Date(consent.tc_accepted_date);
  if (isNaN(date.getTime())) {
    throw new BadRequestError('Invalid T&C acceptance timestamp format');
  }

  logger.debug({ ip: consent.tc_ip_address, date: consent.tc_accepted_date }, 'T&C consent validated');
}

/**
 * Builds the list of clause titles that were accepted.
 * Used to populate the ss_tc_clauses_accepted field on the contact.
 */
export function buildAcceptedClausesList(clauseSlots: ClauseSlot[]): string {
  return clauseSlots
    .filter((slot) => slot.title && slot.text)
    .map((slot) => slot.title)
    .join(', ');
}

/** Escapes HTML special characters to prevent XSS in compiled T&C. */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
