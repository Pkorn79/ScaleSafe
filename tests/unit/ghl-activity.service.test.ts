const mockCreateEventIfNew = jest.fn();
const mockListAppointmentMappings = jest.fn();
const mockListRecent = jest.fn();
const mockListUnmatched = jest.fn();
const mockUpsertAppointmentMapping = jest.fn();
const mockDeactivateAppointmentMapping = jest.fn();
const mockLogEvidence = jest.fn();
const mockOfferFindById = jest.fn();
const mockOfferListByLocation = jest.fn();
const mockSupabaseFrom = jest.fn();

jest.mock('../../src/repositories/ghlActivity.repository', () => ({
  ghlActivityRepository: {
    createEventIfNew: (...args: any[]) => mockCreateEventIfNew(...args),
    listAppointmentMappings: (...args: any[]) => mockListAppointmentMappings(...args),
    listRecent: (...args: any[]) => mockListRecent(...args),
    listUnmatched: (...args: any[]) => mockListUnmatched(...args),
    upsertAppointmentMapping: (...args: any[]) => mockUpsertAppointmentMapping(...args),
    deactivateAppointmentMapping: (...args: any[]) => mockDeactivateAppointmentMapping(...args),
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

jest.mock('../../src/clients/ghl.client', () => ({
  ghlApi: jest.fn().mockResolvedValue({ get: jest.fn().mockResolvedValue({ data: { calendars: [] } }) }),
}));

import { ghlActivityService } from '../../src/services/ghl-activity.service';
import { EVIDENCE_TYPES } from '../../src/constants/evidence-types';

function mockEnrollmentQuery(enrollments: any[]) {
  mockSupabaseFrom.mockImplementation((table: string) => {
    if (table === 'enrollments') {
      const chain: any = {
        select: () => chain,
        eq: () => chain,
        in: () => chain,
        order: () => chain,
        limit: () => Promise.resolve({ data: enrollments, error: null }),
        maybeSingle: () => Promise.resolve({ data: enrollments[0] || null, error: null }),
      };
      return chain;
    }
    if (table === 'ghl_activity_events') {
      const chain: any = {
        update: () => chain,
        eq: () => Promise.resolve({ data: null, error: null }),
      };
      return chain;
    }
    return {};
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockListAppointmentMappings.mockResolvedValue([]);
  mockListRecent.mockResolvedValue([]);
  mockListUnmatched.mockResolvedValue([]);
  mockOfferFindById.mockResolvedValue({ id: 'offer_1', offer_name: 'Beta Tester' });
  mockOfferListByLocation.mockResolvedValue([]);
  mockCreateEventIfNew.mockResolvedValue({
    inserted: true,
    row: { id: 'evt_1', normalized: {} },
  });
  mockLogEvidence.mockResolvedValue(undefined);
  mockEnrollmentQuery([{ id: 'enr_1', offer_id: 'offer_1', status: 'active' }]);
});

describe('ghlActivityService', () => {
  test('normalizes official appointment payloads', () => {
    const normalized = ghlActivityService.normalizePayload({
      type: 'AppointmentCreate',
      locationId: 'loc_1',
      event_body: {
        appointmentId: 'appt_1',
        contactId: 'contact_1',
        calendarId: 'cal_1',
        title: 'Strategy Session',
        startTime: '2026-06-01T15:00:00.000Z',
      },
    });

    expect(normalized.sourceObject).toBe('appointment');
    expect(normalized.locationId).toBe('loc_1');
    expect(normalized.contactId).toBe('contact_1');
    expect(normalized.sourceRecordId).toBe('appt_1');
    expect(normalized.calendarId).toBe('cal_1');
  });

  test('creates appointment evidence when one active enrollment is confidently matched', async () => {
    const result = await ghlActivityService.handleWebhook({
      type: 'AppointmentCreate',
      locationId: 'loc_1',
      event_body: {
        appointmentId: 'appt_1',
        contactId: 'contact_1',
        calendarId: 'cal_1',
        title: 'Strategy Session',
        startTime: '2026-06-01T15:00:00.000Z',
      },
    });

    expect(result.actionTaken).toBe('appointment_evidence_created');
    expect(mockCreateEventIfNew).toHaveBeenCalledWith(expect.objectContaining({
      location_id: 'loc_1',
      contact_id: 'contact_1',
      source_object: 'appointment',
      source_record_id: 'appt_1',
      status: 'matched',
      match_reason: 'single_active_enrollment',
    }));
    expect(mockLogEvidence).toHaveBeenCalledWith(
      EVIDENCE_TYPES.APPOINTMENT,
      'loc_1',
      'contact_1',
      'ghl_calendar',
      expect.objectContaining({
        enrollment_id: 'enr_1',
        appointment_id: 'appt_1',
        appointment_title: 'Strategy Session',
      }),
    );
  });

  test('keeps duplicate GHL activity from creating duplicate evidence', async () => {
    mockCreateEventIfNew.mockResolvedValueOnce({
      inserted: false,
      row: { id: 'evt_existing', action_taken: 'appointment_evidence_created' },
    });

    const result = await ghlActivityService.handleWebhook({
      type: 'AppointmentCreate',
      locationId: 'loc_1',
      event_body: { appointmentId: 'appt_1', contactId: 'contact_1' },
    });

    expect(result.status).toBe('duplicate');
    expect(mockLogEvidence).not.toHaveBeenCalled();
  });

  test('creates invoice evidence for invoice events with a contact', async () => {
    const result = await ghlActivityService.handleWebhook({
      type: 'InvoicePaid',
      locationId: 'loc_1',
      event_body: {
        invoiceId: 'inv_1',
        invoiceNumber: 'INV-1001',
        contactId: 'contact_1',
        amount: 125,
        currency: 'USD',
        status: 'paid',
      },
    });

    expect(result.actionTaken).toBe('invoice_evidence_created');
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
});
