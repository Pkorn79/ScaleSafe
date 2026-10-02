const insert = jest.fn();
const put = jest.fn();
const fire = jest.fn();
const from = jest.fn();
const findEnrollment = jest.fn();
const getMerchant = jest.fn();

jest.mock('../../src/repositories/evidence.repository', () => ({
  evidenceRepository: {
    insert: (...args: any[]) => insert(...args),
    getCounts: jest.fn().mockResolvedValue({}),
    getLastEvidenceDate: jest.fn().mockResolvedValue(null),
  },
}));
jest.mock('../../src/clients/ghl.client', () => ({
  ghlApi: async () => ({ put }),
}));
jest.mock('../../src/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
jest.mock('../../src/clients/supabase.client', () => ({ getSupabase: () => ({ from }) }));
jest.mock('../../src/services/trigger.service', () => ({
  triggerService: { fireTrigger: (...args: any[]) => fire(...args) },
}));
jest.mock('../../src/services/command-center-health.service', () => ({
  commandCenterHealthService: { markMerchantDirty: jest.fn() },
}));
jest.mock('../../src/repositories/merchant.repository', () => ({
  merchantRepository: { getByLocationId: (...args: any[]) => getMerchant(...args) },
}));
jest.mock('../../src/repositories/enrollment.repository', () => ({
  enrollmentRepository: { findById: (...args: any[]) => findEnrollment(...args) },
}));

import { evidenceService } from '../../src/services/evidence.service';
import { SS_CONTACT_FIELDS } from '../../src/constants/ghl-fields';
import { EvidenceType } from '../../src/constants/evidence-types';

const enrollment = {
  id: 'enrollment-1', location_id: 'location-1', contact_id: 'contact-1',
  offer_id: 'offer-1', program_name_snapshot: 'Group Program',
};
const form = (data: Record<string, unknown>) =>
  evidenceService.handleFormSubmission('SYS2-07', 'location-1', 'contact-1', { session_date: '2026-10-01', ...data });
const engagementWrites = () => put.mock.calls.filter(([, body]) =>
  body.customField?.[SS_CONTACT_FIELDS.ENGAGEMENT_STATUS] === 'Active');

beforeEach(() => {
  jest.resetAllMocks();
  insert.mockResolvedValue(undefined);
  put.mockResolvedValue({ data: {} });
  fire.mockResolvedValue({ sent: 1, failed: 0 });
  findEnrollment.mockResolvedValue(enrollment);
  getMerchant.mockResolvedValue({ engagement_enabled: true });
  from.mockImplementation(() => {
    const chain: any = {};
    for (const key of ['select', 'eq', 'in', 'order', 'limit']) chain[key] = jest.fn(() => chain);
    chain.maybeSingle = jest.fn().mockResolvedValue({ data: { id: 'risk', dunning_status: 'active' } });
    chain.then = (resolve: any) => Promise.resolve({ data: [] }).then(resolve);
    return chain;
  });
  jest.spyOn(evidenceService, 'calculateReadinessScore').mockResolvedValue({ score: 0, breakdown: {} } as any);
  jest.spyOn(evidenceService, 'checkEvidenceMilestone').mockResolvedValue(undefined);
});
afterEach(() => jest.restoreAllMocks());

test.each([false, 'false', ' FALSE ', 0, '0', 'no'])('explicit no_show=%p records attendance and only its follow-up', async (no_show) => {
  await form({ no_show, duration: 45 });
  expect(insert).toHaveBeenCalledWith('session_delivery', expect.objectContaining({
    attendance_status: 'attended', no_show: false, proof_role: 'service_delivery',
  }));
  expect(fire.mock.calls.map(([, key]) => key)).toEqual(['ss_session_logged']);
  expect(engagementWrites()).toHaveLength(1);
});

test.each([true, 'true', ' TRUE ', 1, '1', 'yes'])('explicit no_show=%p records absence and only no-show follow-up', async (no_show) => {
  await form({ no_show, enrollment_id: enrollment.id });
  expect(insert).toHaveBeenCalledWith('session_delivery', expect.objectContaining({
    attendance_status: 'no_show', no_show: true, proof_role: 'client_engagement',
  }));
  expect(fire).toHaveBeenCalledTimes(1);
  expect(fire).toHaveBeenCalledWith('location-1', 'ss_session_noshow', expect.objectContaining({
    enrollment_id: enrollment.id, offer_id: 'offer-1', program_name: 'Group Program',
    follow_up_action: 'reschedule_needed',
  }));
  expect(engagementWrites()).toHaveLength(0);
});

test.each([
  {}, { no_show: '' }, { no_show: 'not sure' }, { no_show: [] },
  { no_show: false, attendance_status: 'scheduled' },
  { no_show: true, attendance_status: 'attended' },
  { no_show: false, attendance_status: 'no_show' },
])('uncertain/conflicting form %p cannot assert attendance or send follow-ups', async (data) => {
  await form(data);
  expect(insert).toHaveBeenCalledWith('session_delivery', expect.objectContaining({
    attendance_status: null, no_show: null, proof_role: 'client_engagement',
  }));
  expect(fire).not.toHaveBeenCalled();
  expect(engagementWrites()).toHaveLength(0);
});

test.each(['cancelled', 'rescheduled'])('preserves %s without firing attendance workflows', async (attendance_status) => {
  await form({ attendance_status });
  expect(insert).toHaveBeenCalledWith('session_delivery', expect.objectContaining({ attendance_status }));
  expect(fire).not.toHaveBeenCalled();
});

test.each(['enrollment_id', 'enrollmentId'])('preserves and validates %s before writing', async (key) => {
  await form({ no_show: false, [key]: enrollment.id });
  expect(findEnrollment).toHaveBeenCalledWith(enrollment.id, 'location-1');
  expect(insert).toHaveBeenCalledWith('session_delivery', expect.objectContaining({
    enrollment_id: enrollment.id,
    defense_metadata: expect.objectContaining({ service: expect.objectContaining({ enrollmentId: enrollment.id, offerId: 'offer-1' }) }),
  }));
});

test.each([
  null,
  { ...enrollment, location_id: 'other-location' },
  { ...enrollment, contact_id: 'other-contact' },
])('rejects missing or foreign enrollment %p before any write', async (record) => {
  findEnrollment.mockResolvedValue(record);
  await expect(form({ no_show: false, enrollment_id: enrollment.id })).rejects.toThrow('does not belong');
  expect(insert).not.toHaveBeenCalled();
  expect(fire).not.toHaveBeenCalled();
});

test('does not infer an enrollment when the form has none', async () => {
  await form({ no_show: false });
  expect(findEnrollment).not.toHaveBeenCalled();
  expect(insert).toHaveBeenCalledWith('session_delivery', expect.objectContaining({ enrollment_id: null }));
});

test.each([
  ['appointment', { appointment_status: 'no_show' }],
  ['appointment', { appointment_status: 'scheduled' }],
  ['appointment', { appointment_status: 'cancelled' }],
  ['session_attendance', { status: 'no_show' }],
  ['external_session', { proof_role: 'client_engagement' }],
  ['external_session', { status: 'scheduled', proof_role: 'service_delivery' }],
] as [EvidenceType, Record<string, unknown>][])('%s %p does not re-engage an at-risk client', async (type, data) => {
  await evidenceService.logEvidence(type, 'location-1', 'contact-1', 'test', data);
  expect(engagementWrites()).toHaveLength(0);
});

test.each([
  ['appointment', { appointment_status: 'completed' }],
  ['session_attendance', { status: 'attended' }],
  ['external_session', { proof_role: 'service_delivery' }],
] as [EvidenceType, Record<string, unknown>][])('%s %p still records genuine participation', async (type, data) => {
  await evidenceService.logEvidence(type, 'location-1', 'contact-1', 'test', data);
  expect(engagementWrites()).toHaveLength(1);
});

test('respects the merchant engagement toggle', async () => {
  getMerchant.mockResolvedValue({ engagement_enabled: false });
  await form({ no_show: false });
  expect(engagementWrites()).toHaveLength(0);
});

test('cannot enable engagement when merchant settings could not be loaded', async () => {
  getMerchant.mockRejectedValue(new Error('settings unavailable'));
  await form({ no_show: false });
  expect(engagementWrites()).toHaveLength(0);
});

test('a failed evidence write does not send a session follow-up', async () => {
  insert.mockRejectedValue(new Error('evidence unavailable'));
  await expect(form({ no_show: false })).rejects.toThrow('evidence unavailable');
  expect(fire).not.toHaveBeenCalled();
});

test('an explicit Present outcome can replace an omitted no-show checkbox', async () => {
  await form({ attendance_status: 'Present' });
  expect(insert).toHaveBeenCalledWith('session_delivery', expect.objectContaining({ attendance_status: 'attended', no_show: false }));
  expect(fire.mock.calls.map(([, key]) => key)).toEqual(['ss_session_logged']);
});
