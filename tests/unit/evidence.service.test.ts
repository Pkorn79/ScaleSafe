/**
 * Evidence service tests.
 * Tests evidence routing, form handling, external event mapping, and readiness scoring.
 */

// Mock Supabase before imports
const mockInsert = jest.fn().mockReturnValue({ error: null });
const mockFrom = jest.fn().mockReturnValue({ insert: mockInsert });
const mockGetTimeline = jest.fn();
const mockGetCounts = jest.fn();
const mockGetLastDate = jest.fn();

jest.mock('../../src/clients/supabase.client', () => ({
  getSupabase: () => ({ from: mockFrom }),
}));

jest.mock('../../src/repositories/evidence.repository', () => ({
  evidenceRepository: {
    insert: jest.fn().mockResolvedValue(undefined),
    getTimeline: mockGetTimeline,
    getCounts: mockGetCounts,
    getLastEvidenceDate: mockGetLastDate,
    getFullSnapshot: jest.fn().mockResolvedValue([]),
  },
}));

jest.mock('../../src/clients/ghl.client', () => ({
  ghlApi: jest.fn().mockResolvedValue({
    put: jest.fn().mockResolvedValue({ data: {} }),
  }),
}));

import { evidenceService } from '../../src/services/evidence.service';
import { evidenceRepository } from '../../src/repositories/evidence.repository';
import { EVIDENCE_TYPES } from '../../src/constants/evidence-types';

beforeEach(() => {
  jest.clearAllMocks();
});

describe('Evidence Service - Form Handling', () => {
  test('SYS2-07 maps to session_delivery', async () => {
    const result = await evidenceService.handleFormSubmission(
      'SYS2-07', 'loc_1', 'contact_1',
      { session_date: '2026-03-20', duration: 60, topics: 'Sales strategy', notes: 'Good session' },
    );
    expect(result).toBe(EVIDENCE_TYPES.SESSION_DELIVERY);
    expect(evidenceRepository.insert).toHaveBeenCalledWith(
      'session_delivery',
      expect.objectContaining({ location_id: 'loc_1', contact_id: 'contact_1' }),
    );
  });

  test('SYS2-08 maps to module_completion', async () => {
    const result = await evidenceService.handleFormSubmission(
      'SYS2-08', 'loc_1', 'contact_1',
      { module_name: 'Module 3', completion_date: '2026-03-20', score: 92 },
    );
    expect(result).toBe(EVIDENCE_TYPES.MODULE_COMPLETION);
  });

  test('SYS2-09 maps to pulse_checkin', async () => {
    const result = await evidenceService.handleFormSubmission(
      'SYS2-09', 'loc_1', 'contact_1',
      { satisfaction: 4, feedback_text: 'Going great' },
    );
    expect(result).toBe(EVIDENCE_TYPES.PULSE_CHECKIN);
  });

  test('SYS2-10 maps to payment_confirmation', async () => {
    const result = await evidenceService.handleFormSubmission(
      'SYS2-10', 'loc_1', 'contact_1',
      { amount: 500, payments_remaining: 3 },
    );
    expect(result).toBe(EVIDENCE_TYPES.PAYMENT_CONFIRMATION);
  });

  test('SYS2-11 maps to cancellation', async () => {
    const result = await evidenceService.handleFormSubmission(
      'SYS2-11', 'loc_1', 'contact_1',
      { reason: 'Financial hardship', refund_eligibility: 'partial' },
    );
    expect(result).toBe(EVIDENCE_TYPES.CANCELLATION);
  });

  test('Unknown form ID returns null', async () => {
    const result = await evidenceService.handleFormSubmission(
      'UNKNOWN-99', 'loc_1', 'contact_1', {},
    );
    expect(result).toBeNull();
  });
});

describe('Evidence Service - External Events', () => {
  test('session_completed maps to external_session', async () => {
    const result = await evidenceService.handleExternalEvent(
      'session_completed', 'loc_1', 'contact_1', 'zoom',
      { session_date: '2026-03-20', duration: 90 },
    );
    expect(result).toBe(EVIDENCE_TYPES.EXTERNAL_SESSION);
  });

  test('no_show maps to session_attendance', async () => {
    const result = await evidenceService.handleExternalEvent(
      'no_show', 'loc_1', 'contact_1', 'calendly',
      { session_date: '2026-03-20' },
    );
    expect(result).toBe(EVIDENCE_TYPES.SESSION_ATTENDANCE);
  });

  test('module_completed maps to module_completion', async () => {
    const result = await evidenceService.handleExternalEvent(
      'module_completed', 'loc_1', 'contact_1', 'teachable',
      { module_name: 'Sales 101', completion_date: '2026-03-20' },
    );
    expect(result).toBe(EVIDENCE_TYPES.MODULE_COMPLETION);
  });

  test('service_access maps to service_access', async () => {
    const result = await evidenceService.handleExternalEvent(
      'service_access', 'loc_1', 'contact_1', 'kajabi',
      { platform: 'kajabi', access_date: '2026-03-20', content_accessed: 'Course 1' },
    );
    expect(result).toBe(EVIDENCE_TYPES.SERVICE_ACCESS);
  });

  test('unknown event type logs as custom_event', async () => {
    const result = await evidenceService.handleExternalEvent(
      'some_unknown_event', 'loc_1', 'contact_1', 'zapier',
      { foo: 'bar' },
    );
    expect(result).toBe(EVIDENCE_TYPES.CUSTOM_EVENT);
  });
});

describe('Evidence Service - Readiness Score', () => {
  test('empty evidence gives score of 0', async () => {
    mockGetCounts.mockResolvedValue({});
    mockGetLastDate.mockResolvedValue(null);

    const { score, breakdown } = await evidenceService.calculateReadinessScore('loc_1', 'contact_1');
    expect(score).toBe(0);
    expect(breakdown.consent.points).toBe(0);
    expect(breakdown.recency.points).toBe(0);
  });

  test('consent alone gives 20 points', async () => {
    mockGetCounts.mockResolvedValue({ consent: 1 });
    mockGetLastDate.mockResolvedValue(new Date().toISOString());

    const { score, breakdown } = await evidenceService.calculateReadinessScore('loc_1', 'contact_1');
    expect(breakdown.consent.points).toBe(20);
    expect(breakdown.consent.max).toBe(20);
  });

  test('full evidence gives high score', async () => {
    mockGetCounts.mockResolvedValue({
      consent: 1,
      enrollment_payment: 1,
      payment_confirmation: 4,
      session_delivery: 5,
      module_completion: 3,
      milestone_completion: 2,
      pulse_checkin: 3,
      milestone_signoff: 2,
      session_attendance: 2,
    });
    mockGetLastDate.mockResolvedValue(new Date().toISOString());

    const { score } = await evidenceService.calculateReadinessScore('loc_1', 'contact_1');
    expect(score).toBeGreaterThanOrEqual(80);
  });

  test('old evidence reduces recency points', async () => {
    mockGetCounts.mockResolvedValue({ consent: 1 });
    const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
    mockGetLastDate.mockResolvedValue(sixtyDaysAgo);

    const { breakdown } = await evidenceService.calculateReadinessScore('loc_1', 'contact_1');
    expect(breakdown.recency.points).toBe(2);
  });

  test('score never exceeds 100', async () => {
    mockGetCounts.mockResolvedValue({
      consent: 5, enrollment_payment: 10, payment_confirmation: 10,
      session_delivery: 20, module_completion: 20, milestone_completion: 20,
      external_session: 20, course_completion: 20,
      pulse_checkin: 20, milestone_signoff: 20, communication: 20,
      session_attendance: 20,
    });
    mockGetLastDate.mockResolvedValue(new Date().toISOString());

    const { score } = await evidenceService.calculateReadinessScore('loc_1', 'contact_1');
    expect(score).toBeLessThanOrEqual(100);
  });
});
