/**
 * tc-clauses.ts — Standard T&C Clause Definitions
 *
 * ScaleSafe provides 9 standard clauses that merchants can enable per-offer.
 * Each clause has a title and default text. Merchants can also add up to 2
 * custom clauses per offer (slots 10-11).
 *
 * These clauses are compiled into clickwrap HTML at offer creation time
 * and shown to clients during enrollment. The consent record (which clauses
 * were accepted, when, and from what IP) is one of the strongest pieces
 * of evidence in a chargeback defense.
 *
 * The clause titles here match the GHL checkbox field names exactly.
 */

export interface StandardClause {
  /** Slot number (1-9 for standard, 10-11 for custom). */
  slot: number;
  /** Short title shown as a heading. */
  title: string;
  /** The GHL toggle field key that enables/disables this clause. */
  toggleFieldKey: string;
  /** Default clause text (merchant can customize via the offer). */
  defaultText: string;
}

/**
 * The 9 standard clauses.
 * Slot numbers 1-9 map to clause_slot_1 through clause_slot_9 on the offer.
 */
export const STANDARD_CLAUSES: StandardClause[] = [
  {
    slot: 1,
    title: 'Purchase Summary',
    toggleFieldKey: 'contact.include_purchase_summary_clause',
    defaultText:
      'I confirm that I am purchasing the program described for the total amount and payment terms shown above.',
  },
  {
    slot: 2,
    title: 'Cardholder Authorization',
    toggleFieldKey: 'contact.include_cardholder_authorization_clause',
    defaultText:
      'I confirm that I am the authorized user of the payment method provided and I approve this transaction for the amount shown.',
  },
  {
    slot: 3,
    title: 'Program Scope',
    toggleFieldKey: 'contact.include_program_scope_clause',
    defaultText:
      'I confirm that I have reviewed the program description and understand what is included in this purchase.',
  },
  {
    slot: 4,
    title: 'No Guaranteed Results',
    toggleFieldKey: 'contact.include_no_guaranteed_results_clause',
    defaultText:
      'I understand that this program provides education, strategy, and support. Results vary and are not guaranteed.',
  },
  {
    slot: 5,
    title: 'Digital Access',
    toggleFieldKey: 'contact.include_digital_access_clause',
    defaultText:
      'I understand that I will receive immediate access to digital materials, program content, and/or coaching services upon enrollment.',
  },
  {
    slot: 6,
    title: 'Participation Responsibility',
    toggleFieldKey: 'contact.include_participation_responsibility_clause',
    defaultText:
      'I understand that access to coaching sessions, materials, or support may require my participation. Failure to attend or utilize the resources provided does not mean the service was not delivered.',
  },
  {
    slot: 7,
    title: 'Feedback & Check-In',
    toggleFieldKey: 'contact.include_feedback__checkin_clause',
    defaultText:
      'I agree to participate in periodic check-ins and provide feedback when requested as part of the program experience.',
  },
  {
    slot: 8,
    title: 'Refund & Cancellation',
    toggleFieldKey: 'contact.include_refund__cancellation_clause',
    defaultText:
      'I have reviewed and agree to the refund and cancellation policy as described. I understand the conditions and deadlines for requesting a refund.',
  },
  {
    slot: 9,
    title: 'Installment Billing',
    toggleFieldKey: 'contact.include_installment_billing_clause',
    defaultText:
      'I authorize the scheduled payments outlined above and understand that this payment plan represents the total program price divided into installments.',
  },
];
