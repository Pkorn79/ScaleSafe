/**
 * Exhibit source failure + noise tests (from the 2026-07-06 live packet test).
 *
 * - An evidence source query failure (e.g. live DB missing
 *   evidence_milestones.enrollment_id) must be recorded in sourceErrors and
 *   logged — never silently swallowed into an empty exhibit list.
 * - Legacy milestone rows carrying the enrollment id only in raw_payload must
 *   still be included under exact scope.
 * - Internal readiness-score custom events are bookkeeping, not evidence.
 * - Unlinked communications never lead the packet; the signed enrollment packet
 *   leads when a reason code's priorities have no consent key.
 */

const mockTableResults: Record<string, { data: any; error: any }> = {};
const mockLoggerError = jest.fn();

jest.mock('../../src/utils/logger', () => ({
  logger: {
    error: (...args: any[]) => mockLoggerError(...args),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
  },
}));

jest.mock('../../src/clients/supabase.client', () => ({
  getSupabase: () => ({
    from: (table: string) => {
      const result = () => mockTableResults[table] || { data: [], error: null };
      const b: any = {};
      for (const m of ['select', 'eq', 'order', 'limit', 'gte', 'lte']) {
        b[m] = () => b;
      }
      b.maybeSingle = () => Promise.resolve(mockTableResults[table] || { data: null, error: null });
      b.then = (resolve: any, reject: any) => Promise.resolve(result()).then(resolve, reject);
      return b;
    },
  }),
}));

jest.mock('../../src/repositories/evidence.repository', () => ({
  evidenceRepository: {
    getTimeline: jest.fn().mockResolvedValue({ rows: [], total: 0 }),
  },
}));

import { defenseExhibitsService } from '../../src/services/defense-exhibits.service';
import { evidenceRepository } from '../../src/repositories/evidence.repository';

const scopeOpts = {
  enrollmentId: 'enr_1',
  scopeConfidence: 'exact',
  offerId: 'offer_1',
  enrollmentStart: '2026-05-01T00:00:00Z',
  enrollmentEnd: null,
};

beforeEach(() => {
  for (const k of Object.keys(mockTableResults)) delete mockTableResults[k];
  jest.clearAllMocks();
  (evidenceRepository.getTimeline as jest.Mock).mockResolvedValue({ rows: [], total: 0 });
});

describe('exhibit source query failures', () => {
  test('a milestones schema failure is recorded in sourceErrors and logged, not swallowed', async () => {
    mockTableResults['evidence_milestones'] = {
      data: null,
      error: { message: 'column evidence_milestones.enrollment_id does not exist' },
    };

    const list = await defenseExhibitsService.buildExhibitList('loc_1', 'c_1', scopeOpts);

    expect(list.sourceErrors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: 'evidence_milestones',
          message: expect.stringContaining('enrollment_id does not exist'),
        }),
      ]),
    );
    expect(mockLoggerError).toHaveBeenCalled();
  });

  test('a healthy build reports zero sourceErrors', async () => {
    const list = await defenseExhibitsService.buildExhibitList('loc_1', 'c_1', scopeOpts);
    expect(list.sourceErrors).toEqual([]);
  });
});

describe('legacy milestone rows (enrollment id only in raw_payload)', () => {
  test('are included for exact enrollment scope; other-program rows are not', async () => {
    mockTableResults['evidence_milestones'] = {
      data: [
        { id: 'ms_legacy', enrollment_id: null, milestone_number: 1, milestone_name: 'Merchant Setup', completed_at: '2026-06-03T17:23:01Z', raw_payload: { enrollmentId: 'enr_1' } },
        { id: 'ms_other', enrollment_id: null, milestone_number: 1, milestone_name: 'Other Program', completed_at: '2026-06-03T17:23:01Z', raw_payload: { enrollmentId: 'enr_other' } },
      ],
      error: null,
    };

    const list = await defenseExhibitsService.buildExhibitList('loc_1', 'c_1', scopeOpts);

    const milestoneRefs = list.exhibits.filter((e) => e.source === 'evidence_milestones').map((e) => e.ref);
    expect(milestoneRefs).toEqual(['ms_legacy']);
    expect(list.sourceErrors).toEqual([]);
  });
});

describe('milestone summary composition', () => {
  test('a thin defense_summary does not replace the composed delivery story', async () => {
    mockTableResults['evidence_milestones'] = {
      data: [{
        id: 'ms_1', enrollment_id: 'enr_1', milestone_number: 1, milestone_name: 'Merchant Setup',
        completed_at: '2026-06-03T17:23:01Z',
        description: 'Access to ScaleSafe',
        notes: 'Access ScaleSafe and put your information into the Settings section.',
        defense_summary: 'Access to ScaleSafe', // the thin live summary
      }],
      error: null,
    };

    const list = await defenseExhibitsService.buildExhibitList('loc_1', 'c_1', scopeOpts);

    const ms = list.exhibits.find((e) => e.ref === 'ms_1');
    expect(ms?.summary).toContain('marked complete');
    expect(ms?.summary).toContain('Deliverables: Access to ScaleSafe');
    expect(ms?.summary).toContain('Client responsibility: Access ScaleSafe and put your information');
  });
});

describe('noise filtering', () => {
  test('contact-only scope never selects the newest signed packet from another enrollment', async () => {
    mockTableResults['enrollments'] = {
      data: { id: 'enr_newest', packet_pdf_path: 'packets/wrong-program.pdf', enrolled_at: '2026-07-01T00:00:00Z', offer_id: 'offer_other' },
      error: null,
    };

    const list = await defenseExhibitsService.buildExhibitList('loc_1', 'c_1', {
      scopeConfidence: 'contact_only',
    });

    expect(list.enrollmentPacketPath).toBeNull();
    expect(list.exhibits.some((e) => e.source === 'enrollment_packet_pdf')).toBe(false);
  });

  test('communications with unrendered merge fields are excluded from exhibits', async () => {
    mockTableResults['evidence_communication'] = {
      data: [
        {
          id: 'comm_broken', enrollment_id: 'enr_1', comm_type: 'Email', direction: 'outbound',
          comm_date: '2026-06-07T00:48:45Z',
          body_preview: 'Program: ScaleSafe Beta Amount: Next payment date: Payment number: of If you have questions, please contact .',
        },
        {
          id: 'comm_ok', enrollment_id: 'enr_1', comm_type: 'Email', direction: 'outbound',
          comm_date: '2026-06-03T17:29:24Z',
          body_preview: 'This confirms that a refund has been processed. Refund amount: $0.50 Refund date: 2026-06-03',
        },
      ],
      error: null,
    };

    const list = await defenseExhibitsService.buildExhibitList('loc_1', 'c_1', scopeOpts);

    const refs = list.exhibits.map((e) => e.ref);
    expect(refs).toContain('comm_ok');
    expect(refs).not.toContain('comm_broken');
  });

  test('internal readiness-score custom events are excluded; genuine custom events kept', async () => {
    (evidenceRepository.getTimeline as jest.Mock).mockResolvedValue({
      rows: [
        {
          id: 'ev_score', evidence_type: 'custom_event', enrollment_id: 'enr_1',
          created_at: '2026-06-03T17:16:59Z',
          data: { event_type: 'evidence_milestone', evidence_count: 18, readiness_score: 53, milestone_threshold: 50 },
        },
        {
          id: 'ev_real', evidence_type: 'custom_event', enrollment_id: 'enr_1',
          created_at: '2026-06-04T10:00:00Z',
          data: { event_type: 'portal_login', platform: 'client portal' },
        },
      ],
      total: 2,
    });

    const list = await defenseExhibitsService.buildExhibitList('loc_1', 'c_1', scopeOpts);

    const refs = list.exhibits.map((e) => e.ref);
    expect(refs).not.toContain('ev_score');
    expect(refs).toContain('ev_real');
  });

  test('signed packet leads and unlinked comms sort last for 4855-style priorities (no consent key)', async () => {
    mockTableResults['enrollments'] = {
      data: { id: 'enr_1', packet_pdf_path: 'packets/enr_1.pdf', enrolled_at: '2026-05-06T21:06:53Z', offer_id: null },
      error: null,
    };
    mockTableResults['evidence_milestones'] = {
      data: [
        { id: 'ms_1', enrollment_id: 'enr_1', milestone_number: 1, milestone_name: 'Merchant Setup', completed_at: '2026-06-03T17:23:01Z' },
      ],
      error: null,
    };
    mockTableResults['evidence_communication'] = {
      data: [
        // Unlinked workflow email inside the service window — kept, but never leading
        { id: 'comm_u', enrollment_id: null, comm_type: 'Email', direction: 'outbound', comm_date: '2026-06-07T00:48:45Z', body_preview: 'Payment reminder' },
      ],
      error: null,
    };

    const list = await defenseExhibitsService.buildExhibitList('loc_1', 'c_1', {
      ...scopeOpts,
      // Mastercard 4855 priorities — note: no 'consent' key
      evidencePriorities: ['sessions', 'modules', 'milestones', 'service_access', 'signoffs', 'communication'],
    });

    const order = list.exhibits.map((e) => e.source);
    expect(order[0]).toBe('enrollment_packet_pdf');
    expect(list.exhibits[0].letter).toBe('A');
    expect(order[order.length - 1]).toBe('evidence_communication');
    const comm = list.exhibits.find((e) => e.ref === 'comm_u');
    expect(comm?.deprioritized).toBe(true);
  });
});
