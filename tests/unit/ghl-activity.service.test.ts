const mockCreateEventIfNew = jest.fn();
const mockListRecent = jest.fn();
const mockListUnmatched = jest.fn();
const mockLinkActivityToEnrollment = jest.fn();
const mockLogEvidence = jest.fn();
const mockOfferFindById = jest.fn();
const mockOfferListByLocation = jest.fn();
const mockSupabaseFrom = jest.fn();
const mockVerifyPublicActionToken = jest.fn();

jest.mock('../../src/repositories/ghlActivity.repository', () => ({
  ghlActivityRepository: {
    createEventIfNew: (...args: any[]) => mockCreateEventIfNew(...args),
    listRecent: (...args: any[]) => mockListRecent(...args),
    listUnmatched: (...args: any[]) => mockListUnmatched(...args),
    linkActivityToEnrollment: (...args: any[]) => mockLinkActivityToEnrollment(...args),
  },
}));

jest.mock('../../src/services/evidence.service', () => ({
  evidenceService: {
    logEvidence: (...args: any[]) => mockLogEvidence(...args),
  },
}));

jest.mock('../../src/repositories/offer.repository', () => ({
  offerRepository: {
    findById: (...args: any[]) => mockOfferFindById(...args),
    listByLocation: (...args: any[]) => mockOfferListByLocation(...args),
  },
}));

jest.mock('../../src/clients/supabase.client', () => ({
  getSupabase: () => ({ from: (...args: any[]) => mockSupabaseFrom(...args) }),
}));

jest.mock('../../src/utils/public-action-token', () => ({
  verifyPublicActionToken: (...args: any[]) => mockVerifyPublicActionToken(...args),
}));

import { ghlActivityService } from '../../src/services/ghl-activity.service';
import { EVIDENCE_TYPES } from '../../src/constants/evidence-types';

function queryResult(result: any, maybeSingleData?: any) {
  const chain: any = {
    select: () => chain,
    eq: () => chain,
    in: () => chain,
    order: () => chain,
    gte: () => chain,
    lte: () => chain,
    limit: () => Promise.resolve(result),
    maybeSingle: () => Promise.resolve({ data: maybeSingleData ?? result.data?.[0] ?? null, error: result.error || null }),
    then: (resolve: any) => Promise.resolve(result).then(resolve),
  };
  return chain;
}

function mockEnrollmentQuery(enrollments: any[], offers: any[] = [{ id: 'offer_1', offer_name: 'Beta Tester' }]) {
  mockSupabaseFrom.mockImplementation((table: string) => {
    if (table === 'enrollments') {
      return queryResult({ data: enrollments, error: null });
    }
    if (table === 'offers_mirror') {
      return queryResult({ data: offers, error: null });
    }
    if (table === 'ghl_activity_events') {
      const chain: any = {
        update: () => chain,
        eq: () => Promise.resolve({ data: null, error: null }),
      };
      return chain;
    }
    if (table === 'evidence_communication') {
      return queryResult({ data: [], error: null });
    }
    return {};
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockListRecent.mockResolvedValue([]);
  mockListUnmatched.mockResolvedValue([]);
  mockOfferFindById.mockResolvedValue({ id: 'offer_1', offer_name: 'Beta Tester' });
  mockOfferListByLocation.mockResolvedValue([]);
  mockCreateEventIfNew.mockResolvedValue({
    inserted: true,
    row: { id: 'evt_1', normalized: {} },
  });
  mockVerifyPublicActionToken.mockImplementation(() => {
    throw new Error('unexpected token');
  });
  mockLogEvidence.mockResolvedValue(undefined);
  mockEnrollmentQuery([{ id: 'enr_1', offer_id: 'offer_1', status: 'active' }]);
});

describe('ghlActivityService', () => {
  test('normalizes official appointment payloads', () => {
    const normalized = ghlActivityService.normalizePayload({
      type: 'AppointmentCreate',
      locationId: 'loc_1',
      appointment: {
        id: 'appt_1',
        contactId: 'contact_1',
        calendarId: 'cal_1',
        title: 'Strategy Session',
        appointmentStatus: 'confirmed',
        startTime: '2026-06-01T15:00:00.000Z',
      },
    });

    expect(normalized.sourceObject).toBe('appointment');
    expect(normalized.locationId).toBe('loc_1');
    expect(normalized.contactId).toBe('contact_1');
    expect(normalized.sourceRecordId).toBe('appt_1');
    expect(normalized.calendarId).toBe('cal_1');
    expect(normalized.status).toBe('confirmed');
  });

  test('creates client-level appointment evidence without requiring calendar mapping', async () => {
    const result = await ghlActivityService.handleWebhook({
      type: 'AppointmentCreate',
      locationId: 'loc_1',
      appointment: {
        id: 'appt_1',
        contactId: 'contact_1',
        calendarId: 'cal_1',
        title: 'Strategy Session',
        appointmentStatus: 'confirmed',
        startTime: '2026-06-01T15:00:00.000Z',
      },
    });

    expect(result.actionTaken).toBe('appointment_evidence_created');
    expect(mockCreateEventIfNew).toHaveBeenCalledWith(expect.objectContaining({
      location_id: 'loc_1',
      contact_id: 'contact_1',
      source_object: 'appointment',
      source_record_id: 'appt_1',
      status: 'client_level',
      match_reason: 'client_level_unmatched_to_enrollment',
    }));
    expect(mockLogEvidence).toHaveBeenCalledWith(
      EVIDENCE_TYPES.APPOINTMENT,
      'loc_1',
      'contact_1',
      'ghl_calendar',
      expect.objectContaining({
        enrollment_id: null,
        appointment_id: 'appt_1',
        appointment_title: 'Strategy Session',
      }),
    );
  });

  test('keeps GHL invoices client-level instead of guessing a program from line items', async () => {
    const result = await ghlActivityService.handleWebhook({
      locationId: 'loc_1',
      _id: 'inv_1',
      invoiceNumber: 'INV-1001',
      contactDetails: { id: 'contact_1' },
      invoiceItems: [{ name: 'Beta Tester', qty: 1, amount: 125 }],
      total: 125,
      amountPaid: 125,
      currency: 'USD',
      status: 'paid',
    });

    expect(result.actionTaken).toBe('invoice_evidence_created');
    expect(mockCreateEventIfNew).toHaveBeenCalledWith(expect.objectContaining({
      location_id: 'loc_1',
      contact_id: 'contact_1',
      offer_id: null,
      status: 'client_level',
      match_reason: 'client_level_unmatched_to_enrollment',
      linked_enrollment_ids: [],
      linked_offer_ids: [],
    }));
    expect(mockLinkActivityToEnrollment).not.toHaveBeenCalled();
  });

  test('keeps duplicate GHL activity from creating duplicate evidence', async () => {
    mockCreateEventIfNew.mockResolvedValueOnce({
      inserted: false,
      row: { id: 'evt_existing', action_taken: 'appointment_evidence_created' },
    });

    const result = await ghlActivityService.handleWebhook({
      type: 'AppointmentCreate',
      locationId: 'loc_1',
      appointment: { id: 'appt_1', contactId: 'contact_1' },
    });

    expect(result.status).toBe('duplicate');
    expect(mockLogEvidence).not.toHaveBeenCalled();
  });

  test('links ScaleSafe action-link communications to the exact enrollment', async () => {
    mockVerifyPublicActionToken.mockReturnValueOnce({
      action: 'pulse_checkin',
      locationId: 'loc_1',
      contactId: 'contact_1',
      enrollmentId: 'enr_pulse',
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    mockEnrollmentQuery([
      { id: 'enr_pulse', offer_id: 'offer_pulse', status: 'active' },
    ], [
      { id: 'offer_pulse', offer_name: 'Pulse Program' },
    ]);

    const result = await ghlActivityService.handleWebhook({
      type: 'OutboundMessage',
      locationId: 'loc_1',
      contactId: 'contact_1',
      conversationId: 'conv_1',
      messageId: 'msg_pulse_1',
      direction: 'outbound',
      messageType: 'Email',
      plainText: 'Please complete your pulse: https://dashboard.scalesafe.app/pulse-check?actionToken=tok_123',
      dateAdded: '2026-07-07T21:59:00.000Z',
    });

    expect(result.actionTaken).toBe('communication_evidence_created');
    expect(mockCreateEventIfNew).toHaveBeenCalledWith(expect.objectContaining({
      enrollment_id: 'enr_pulse',
      offer_id: 'offer_pulse',
      status: 'matched',
      match_reason: 'public_action_link_pulse_checkin',
      match_confidence: 'strong',
      linked_enrollment_ids: ['enr_pulse'],
    }));
    expect(mockLinkActivityToEnrollment).toHaveBeenCalledWith(expect.objectContaining({
      enrollmentId: 'enr_pulse',
      offerId: 'offer_pulse',
      reason: 'public_action_link_pulse_checkin',
    }));
    expect(mockLogEvidence).toHaveBeenCalledWith(
      EVIDENCE_TYPES.COMMUNICATION,
      'loc_1',
      'contact_1',
      'ghl_webhook',
      expect.objectContaining({ enrollment_id: 'enr_pulse' }),
    );
  });

  test('does not guess an enrollment when an offer name matches multiple active enrollments', async () => {
    mockEnrollmentQuery([
      { id: 'enr_a', offer_id: 'offer_1', status: 'active' },
      { id: 'enr_b', offer_id: 'offer_1', status: 'active' },
    ], [
      { id: 'offer_1', offer_name: 'Beta Tester' },
    ]);

    await ghlActivityService.handleWebhook({
      type: 'OutboundMessage',
      locationId: 'loc_1',
      contactId: 'contact_1',
      conversationId: 'conv_1',
      messageId: 'msg_ambiguous_1',
      direction: 'outbound',
      messageType: 'Email',
      plainText: 'This confirms your payment for Beta Tester.',
      dateAdded: '2026-07-07T21:59:00.000Z',
    });

    expect(mockCreateEventIfNew).toHaveBeenCalledWith(expect.objectContaining({
      enrollment_id: null,
      offer_id: null,
      status: 'client_level',
      match_reason: 'client_level_unmatched_to_enrollment',
    }));
    expect(mockLinkActivityToEnrollment).not.toHaveBeenCalled();
  });

  test('creates invoice evidence for invoice events with a contact', async () => {
    const result = await ghlActivityService.handleWebhook({
      locationId: 'loc_1',
      _id: 'inv_1',
      invoiceNumber: 'INV-1001',
      contactDetails: {
        id: 'contact_1',
      },
      invoiceItems: [{ name: 'Beta Tester', qty: 1, amount: 125 }],
      total: 125,
      amountPaid: 125,
      currency: 'USD',
      status: 'paid',
      dueDate: '2026-06-02',
      createdAt: '2026-06-01T15:00:00.000Z',
    });

    expect(result.actionTaken).toBe('invoice_evidence_created');
    expect(result.eventType).toBe('InvoicePaid');
    expect(mockLogEvidence).toHaveBeenCalledWith(
      EVIDENCE_TYPES.INVOICE,
      'loc_1',
      'contact_1',
      'ghl_invoice',
      expect.objectContaining({
        invoice_id: 'inv_1',
        invoice_number: 'INV-1001',
        amount: 125,
      }),
    );
  });

  test.each([
    ['AppointmentUpdate', { type: 'AppointmentUpdate', locationId: 'loc_1', appointment: { id: 'appt_2', contactId: 'contact_1', calendarId: 'cal_1', title: 'Updated Session' } }, 'appointment', 'appt_2', 'contact_1'],
    ['AppointmentDelete', { type: 'AppointmentDelete', locationId: 'loc_1', appointment: { id: 'appt_3', contactId: 'contact_1', calendarId: 'cal_1', title: 'Deleted Session' } }, 'appointment', 'appt_3', 'contact_1'],
    ['InboundMessage', { type: 'InboundMessage', locationId: 'loc_1', contactId: 'contact_1', conversationId: 'conv_1', messageId: 'msg_in_1', direction: 'inbound', messageType: 'SMS', body: 'I have a question', dateAdded: '2026-06-01T15:00:00.000Z' }, 'communication', 'msg_in_1', 'contact_1'],
    ['OutboundMessage', { type: 'OutboundMessage', locationId: 'loc_1', contactId: 'contact_1', conversationId: 'conv_2', messageId: 'msg_out_1', direction: 'outbound', messageType: 'Email', plainText: 'Here is your update', dateAdded: '2026-06-01T16:00:00.000Z' }, 'communication', 'msg_out_1', 'contact_1'],
    ['InvoiceCreate', { locationId: 'loc_1', _id: 'inv_create', invoiceNumber: 'INV-1', contactDetails: { id: 'contact_1' }, invoiceItems: [], status: 'draft', total: 100 }, 'invoice', 'inv_create', 'contact_1'],
    ['InvoiceSent', { locationId: 'loc_1', _id: 'inv_sent', invoiceNumber: 'INV-2', contactDetails: { id: 'contact_1' }, invoiceItems: [], status: 'sent', total: 100 }, 'invoice', 'inv_sent', 'contact_1'],
    ['InvoicePartiallyPaid', { locationId: 'loc_1', _id: 'inv_partial', invoiceNumber: 'INV-3', contactDetails: { id: 'contact_1' }, invoiceItems: [], status: 'partially_paid', total: 100, amountPaid: 50 }, 'invoice', 'inv_partial', 'contact_1'],
    ['InvoiceUpdate', { locationId: 'loc_1', _id: 'inv_update', invoiceNumber: 'INV-4', contactDetails: { id: 'contact_1' }, invoiceItems: [], status: 'updated', total: 100 }, 'invoice', 'inv_update', 'contact_1'],
    ['InvoiceVoid', { locationId: 'loc_1', _id: 'inv_void', invoiceNumber: 'INV-5', contactDetails: { id: 'contact_1' }, invoiceItems: [], status: 'void', total: 100 }, 'invoice', 'inv_void', 'contact_1'],
    ['InvoiceDelete', { locationId: 'loc_1', _id: 'inv_delete', invoiceNumber: 'INV-6', contactDetails: { id: 'contact_1' }, invoiceItems: [], status: 'deleted', total: 100 }, 'invoice', 'inv_delete', 'contact_1'],
  ])('normalizes official %s payload shape', (expectedType, payload, expectedObject, expectedRecordId, expectedContactId) => {
    const normalized = ghlActivityService.normalizePayload(payload as any);

    expect(normalized.eventType).toBe(expectedType);
    expect(normalized.sourceObject).toBe(expectedObject);
    expect(normalized.sourceRecordId).toBe(expectedRecordId);
    expect(normalized.contactId).toBe(expectedContactId);
  });

  test('infers message direction from official event type when omitted', () => {
    const inbound = ghlActivityService.normalizePayload({
      type: 'InboundMessage',
      locationId: 'loc_1',
      contactId: 'contact_1',
      conversationId: 'conv_1',
      messageId: 'msg_inferred_in',
      messageType: 'SMS',
      body: 'I have a question',
    } as any);

    const outbound = ghlActivityService.normalizePayload({
      type: 'OutboundMessage',
      locationId: 'loc_1',
      contactId: 'contact_1',
      conversationId: 'conv_2',
      messageId: 'msg_inferred_out',
      messageType: 'Email',
      body: 'Here is your receipt',
    } as any);

    expect(inbound.direction).toBe('inbound');
    expect(outbound.direction).toBe('outbound');
  });

  test('cleans HTML email content before saving communication evidence', async () => {
    const result = await ghlActivityService.handleWebhook({
      type: 'OutboundMessage',
      locationId: 'loc_1',
      contactId: 'contact_1',
      conversationId: 'conv_1',
      messageId: 'msg_html_1',
      direction: 'outbound',
      messageType: 'TYPE_EMAIL',
      body: '<div style="font-family:Roboto"><p>Hi Philip,</p><p>This confirms your payment receipt.</p></div>',
      dateAdded: '2026-06-01T15:00:00.000Z',
    });

    expect(result.actionTaken).toBe('communication_evidence_created');
    expect(mockLogEvidence).toHaveBeenCalledWith(
      EVIDENCE_TYPES.COMMUNICATION,
      'loc_1',
      'contact_1',
      'ghl_webhook',
      expect.objectContaining({
        comm_type: 'email',
        direction: 'outbound',
        summary: expect.not.stringContaining('<div'),
        body_preview: expect.stringContaining('Hi Philip'),
        defense_summary: expect.stringContaining('Payment receipt'),
        ghl_conversation_id: 'conv_1',
        ghl_message_id: 'msg_html_1',
      }),
    );
  });
});
