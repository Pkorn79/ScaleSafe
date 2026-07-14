import { evaluateDefenseDraftClaims } from '../../src/services/defense-claim-guard.service';
import type { ExhibitList } from '../../src/services/defense-exhibits.service';

function exhibitList(serviceDelivery: any[] = []): ExhibitList {
  return {
    exhibits: serviceDelivery,
    byCategory: { consent: [], service_delivery: serviceDelivery, communication: [], payments: [], termination: [] },
    totals: { consent: 0, serviceDelivery: serviceDelivery.length, communication: 0, payments: 0, termination: 0 },
    enrollmentPacketPath: null,
    sourceErrors: [],
  };
}

test('rejects an unsupported service-delivery assertion', () => {
  expect(evaluateDefenseDraftClaims(
    'Our records show that the services were delivered to the cardholder.',
    exhibitList(),
  )).toEqual({
    safe: false,
    violations: ['The generated draft asserted service delivery even though no service-delivery exhibit exists.'],
  });
});

test('allows neutral language when no delivery exhibit exists', () => {
  expect(evaluateDefenseDraftClaims(
    'The enrollment agreement and payment record are attached. No service-delivery record is available.',
    exhibitList(),
  ).safe).toBe(true);
});

test('does not let an appointment prove a compound milestone', () => {
  const appointment = { source: 'evidence_appointments', category: 'service_delivery' } as any;
  expect(evaluateDefenseDraftClaims(
    'The completed appointment satisfies the Kickoff milestone, including the written implementation plan.',
    exhibitList([appointment]),
    { milestones: [{ name: 'Kickoff', delivers: 'Live kickoff session and written implementation plan' }] },
  ).safe).toBe(false);
});
