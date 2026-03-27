/**
 * HTTP integration tests for /api/evidence (timeline + Defense Readiness Score).
 */

const mockGetTimeline = jest.fn();
const mockGetCounts = jest.fn();
const mockGetLastEvidenceDate = jest.fn();

jest.mock('../../src/repositories/evidence.repository', () => ({
  evidenceRepository: {
    insert: jest.fn().mockResolvedValue(undefined),
    getFullSnapshot: jest.fn().mockResolvedValue([]),
    getTimeline: (...args: unknown[]) => mockGetTimeline(...args),
    getCounts: (...args: unknown[]) => mockGetCounts(...args),
    getLastEvidenceDate: (...args: unknown[]) => mockGetLastEvidenceDate(...args),
  },
}));

import request from 'supertest';
import { createApp } from '../../src/app';
import { EVIDENCE_TYPES } from '../../src/constants/evidence-types';

const app = createApp();

const authHeaders = { 'x-location-id': 'loc_integration_1' };

describe('GET /api/evidence/:contactId', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetTimeline.mockResolvedValue([]);
  });

  it('returns 401 without SSO context', async () => {
    const res = await request(app).get('/api/evidence/contact_abc');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('AUTHENTICATION_ERROR');
  });

  it('returns timeline JSON and forwards location + contact to repository', async () => {
    const rows = [
      { evidence_type: 'consent', event_date: '2026-01-01', contact_id: 'c1', location_id: 'loc_integration_1' },
    ];
    mockGetTimeline.mockResolvedValue(rows);

    const res = await request(app)
      .get('/api/evidence/c1')
      .set(authHeaders);

    expect(res.status).toBe(200);
    expect(res.body).toEqual(rows);
    expect(mockGetTimeline).toHaveBeenCalledWith('loc_integration_1', 'c1');
  });

  it('returns 500 when timeline repository fails', async () => {
    mockGetTimeline.mockRejectedValue(new Error('database unavailable'));

    const res = await request(app)
      .get('/api/evidence/c_err')
      .set(authHeaders);

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('INTERNAL_ERROR');
  });
});

describe('GET /api/evidence/:contactId/score', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
    mockGetCounts.mockResolvedValue({});
    mockGetLastEvidenceDate.mockResolvedValue(null);
  });

  it('returns 401 without SSO context', async () => {
    const res = await request(app).get('/api/evidence/c1/score');
    expect(res.status).toBe(401);
  });

  it('returns score, breakdown, and caps total at 100', async () => {
    mockGetCounts.mockResolvedValue({
      [EVIDENCE_TYPES.CONSENT]: 1,
      [EVIDENCE_TYPES.ENROLLMENT_PAYMENT]: 5,
      [EVIDENCE_TYPES.SESSION_DELIVERY]: 10,
      [EVIDENCE_TYPES.PULSE_CHECKIN]: 3,
      [EVIDENCE_TYPES.MILESTONE_SIGNOFF]: 1,
      [EVIDENCE_TYPES.COMMUNICATION]: 1,
      [EVIDENCE_TYPES.SESSION_ATTENDANCE]: 2,
    });
    mockGetLastEvidenceDate.mockResolvedValue(new Date().toISOString());

    const res = await request(app)
      .get('/api/evidence/c1/score')
      .set(authHeaders);

    expect(res.status).toBe(200);
    expect(res.body.score).toBe(100);
    expect(res.body.breakdown).toMatchObject({
      consent: expect.objectContaining({ max: 20 }),
      payments: expect.objectContaining({ max: 15 }),
      delivery: expect.objectContaining({ max: 25 }),
      engagement: expect.objectContaining({ max: 20 }),
      reengagement: expect.objectContaining({ max: 10 }),
      recency: expect.objectContaining({ max: 10 }),
    });
    expect(mockGetCounts).toHaveBeenCalledWith('loc_integration_1', 'c1');
  });

  it('returns zeros when there is no evidence', async () => {
    const res = await request(app)
      .get('/api/evidence/empty_contact/score')
      .set(authHeaders);

    expect(res.status).toBe(200);
    expect(res.body.score).toBe(0);
    expect(res.body.breakdown.recency.detail).toBe('No evidence recorded');
  });

  it('assigns recency points by days since last evidence', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-03-27T12:00:00Z'));
    mockGetLastEvidenceDate.mockResolvedValue('2026-03-20T12:00:00Z'); // 7 days

    const res = await request(app)
      .get('/api/evidence/c_recency/score')
      .set(authHeaders);

    expect(res.status).toBe(200);
    expect(res.body.breakdown.recency.points).toBe(10);
    jest.useRealTimers();
  });

  it('accepts counts for all 21 evidence types without error', async () => {
    const allTypes = Object.values(EVIDENCE_TYPES) as string[];
    const counts = Object.fromEntries(allTypes.map((t) => [t, 1]));
    mockGetCounts.mockResolvedValue(counts);
    mockGetLastEvidenceDate.mockResolvedValue('2026-03-27T00:00:00Z');

    const res = await request(app)
      .get('/api/evidence/c_all_types/score')
      .set(authHeaders);

    expect(res.status).toBe(200);
    expect(typeof res.body.score).toBe('number');
    expect(res.body.score).toBeGreaterThanOrEqual(0);
    expect(res.body.score).toBeLessThanOrEqual(100);
    expect(res.body.breakdown.consent).toBeDefined();
    expect(res.body.breakdown.payments).toBeDefined();
    expect(res.body.breakdown.delivery).toBeDefined();
    expect(res.body.breakdown.engagement).toBeDefined();
    expect(res.body.breakdown.reengagement).toBeDefined();
    expect(res.body.breakdown.recency).toBeDefined();
  });
});
