/**
 * CE 3.0 matching engine tests — prior-transaction qualification, identity
 * rules, undisputed filter, and payload shape. Config is mocked to LIVE mode
 * so the 120–364 day window and same-card checks are exercised (test-mode
 * relaxation is covered by the manual E2E flow).
 */

const tableData: Record<string, any> = {};
const queryCalls: Record<string, any[][]> = {};

jest.mock('../../src/clients/supabase.client', () => ({
  getSupabase: () => ({
    from: (table: string) => {
      const calls: any[][] = [];
      (queryCalls[table] = queryCalls[table] || []).push(calls);
      const chain: any = {};
      for (const m of ['select', 'eq', 'neq', 'in', 'gte', 'lte', 'order', 'limit']) {
        chain[m] = jest.fn((...args: any[]) => {
          calls.push([m, ...args]);
          return chain;
        });
      }
      chain.maybeSingle = () => Promise.resolve({ data: tableData[`${table}:single`] ?? null, error: null });
      chain.then = (resolve: any, reject: any) => Promise.resolve({ data: tableData[table] ?? [], error: null }).then(resolve, reject);
      return chain;
    },
  }),
}));

jest.mock('../../src/config', () => ({
  config: { stripe: { secretKey: 'sk_live_abc' } },
}));

jest.mock('../../src/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import { stripeCe3Service } from '../../src/services/stripe-ce3.service';

const merchant = { id: 'm1', location_id: 'loc1' };

function disputeEvent(overrides: Record<string, any> = {}) {
  return {
    id: 'de1',
    contact_id: 'c1',
    stripe_payment_intent_id: 'pi_disputed',
    created_at: '2026-07-01T00:00:00Z',
    raw_dispute_object: { created: 1751328000, payment_intent: 'pi_disputed' }, // 2026-07-01
    ...overrides,
  };
}

function vaultRow(pi: string, overrides: Record<string, any> = {}) {
  return {
    stripe_payment_intent_id: pi,
    stripe_charge_id: `ch_${pi}`,
    customer_ip: '1.2.3.4',
    customer_email: 'client@test.com',
    customer_device_fingerprint: null,
    card_fingerprint: 'fp_1',
    offer_description: 'Coaching program',
    created_at: '2025-09-01T00:00:00Z',
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  for (const k of Object.keys(tableData)) delete tableData[k];
  for (const k of Object.keys(queryCalls)) delete queryCalls[k];

  tableData['stripe_evidence_vault:single'] = vaultRow('pi_disputed');
  tableData['payment_events'] = [
    { id: 'pe1', processor_transaction_id: 'pi_1', created_at: '2025-09-01T00:00:00Z' },
    { id: 'pe2', processor_transaction_id: 'pi_2', created_at: '2025-10-01T00:00:00Z' },
    { id: 'pe3', processor_transaction_id: 'pi_3', created_at: '2025-11-01T00:00:00Z' },
  ];
  tableData['dispute_events'] = []; // no candidate has been disputed
  tableData['stripe_evidence_vault'] = [vaultRow('pi_1'), vaultRow('pi_2'), vaultRow('pi_3')];
});

describe('stripeCe3Service.buildCe3Evidence', () => {
  test('assembles exactly 2 priors with matching IP + email, services + descriptions set', async () => {
    const result = await stripeCe3Service.buildCe3Evidence({
      merchant,
      disputeEvent: disputeEvent(),
      productDescription: 'Test Program — 6-week coaching',
    });

    expect(result.reasons).toEqual([]);
    expect(result.evidence).toBeTruthy();
    expect(result.evidence!.disputed_transaction).toMatchObject({
      customer_email_address: 'client@test.com',
      customer_purchase_ip: '1.2.3.4',
      merchandise_or_services: 'services',
      product_description: 'Test Program — 6-week coaching',
    });
    expect(result.evidence!.disputed_transaction.charge).toBeUndefined();
    expect(result.evidence!.prior_undisputed_transactions).toHaveLength(2);
    for (const prior of result.evidence!.prior_undisputed_transactions) {
      expect(prior.charge).toMatch(/^ch_pi_/);
      expect(prior.customer_purchase_ip).toBe('1.2.3.4');
      expect(prior.customer_email_address).toBe('client@test.com');
      expect(prior.product_description).toBeTruthy();
    }
  });

  test('applies the 120–364 day window in live mode', async () => {
    await stripeCe3Service.buildCe3Evidence({ merchant, disputeEvent: disputeEvent() });

    const paymentEventCalls = (queryCalls['payment_events'] || []).flat();
    const methods = paymentEventCalls.map((c) => c[0]);
    expect(methods).toContain('gte');
    expect(methods).toContain('lte');
  });

  test('fails with a reason when fewer than 2 prior transactions exist', async () => {
    tableData['payment_events'] = [
      { id: 'pe1', processor_transaction_id: 'pi_1', created_at: '2025-09-01T00:00:00Z' },
    ];

    const result = await stripeCe3Service.buildCe3Evidence({ merchant, disputeEvent: disputeEvent() });

    expect(result.evidence).toBeNull();
    expect(result.reasons[0]).toContain('Visa requires 2');
  });

  test('excludes candidates that were themselves disputed', async () => {
    tableData['dispute_events'] = [
      { stripe_payment_intent_id: 'pi_1' },
      { stripe_payment_intent_id: 'pi_2' },
    ];
    // Vault list is filtered by non-disputed PIs in the query; simulate the
    // narrowed result the DB would return.
    tableData['stripe_evidence_vault'] = [vaultRow('pi_3')];

    const result = await stripeCe3Service.buildCe3Evidence({ merchant, disputeEvent: disputeEvent() });

    expect(result.evidence).toBeNull();
    expect(result.reasons[0]).toContain('Only 1 prior transaction');
  });

  test('email alone is NOT enough — a prior with a different IP and no device match is rejected', async () => {
    tableData['stripe_evidence_vault'] = [
      vaultRow('pi_1', { customer_ip: '9.9.9.9' }), // email matches, IP does not, no device fp
      vaultRow('pi_2'),
      vaultRow('pi_3'),
    ];

    const result = await stripeCe3Service.buildCe3Evidence({ merchant, disputeEvent: disputeEvent() });

    expect(result.evidence).toBeTruthy();
    const charges = result.evidence!.prior_undisputed_transactions.map((t) => t.charge);
    expect(charges).not.toContain('ch_pi_1');
  });

  test('device fingerprint + email qualifies a prior whose IP changed', async () => {
    tableData['stripe_evidence_vault:single'] = vaultRow('pi_disputed', { customer_device_fingerprint: 'dev_1' });
    tableData['stripe_evidence_vault'] = [
      vaultRow('pi_1', { customer_ip: '9.9.9.9', customer_device_fingerprint: 'dev_1' }),
      vaultRow('pi_2', { customer_ip: '8.8.8.8', customer_device_fingerprint: 'dev_1' }),
    ];

    const result = await stripeCe3Service.buildCe3Evidence({ merchant, disputeEvent: disputeEvent() });

    expect(result.evidence).toBeTruthy();
    expect(result.evidence!.prior_undisputed_transactions).toHaveLength(2);
  });

  test('rejects priors on a different card in live mode (same payment method rule)', async () => {
    tableData['stripe_evidence_vault'] = [
      vaultRow('pi_1', { card_fingerprint: 'fp_OTHER' }),
      vaultRow('pi_2'),
      vaultRow('pi_3'),
    ];

    const result = await stripeCe3Service.buildCe3Evidence({ merchant, disputeEvent: disputeEvent() });

    expect(result.evidence).toBeTruthy();
    const charges = result.evidence!.prior_undisputed_transactions.map((t) => t.charge);
    expect(charges).not.toContain('ch_pi_1');
  });

  test('prefers same-card priors when more than 2 qualify', async () => {
    tableData['stripe_evidence_vault'] = [
      vaultRow('pi_1', { card_fingerprint: null, created_at: '2025-11-01T00:00:00Z' }),
      vaultRow('pi_2', { card_fingerprint: 'fp_1' }),
      vaultRow('pi_3', { card_fingerprint: 'fp_1' }),
    ];

    const result = await stripeCe3Service.buildCe3Evidence({ merchant, disputeEvent: disputeEvent() });

    const charges = result.evidence!.prior_undisputed_transactions.map((t) => t.charge);
    expect(charges).toEqual(expect.arrayContaining(['ch_pi_2', 'ch_pi_3']));
  });

  test('fails cleanly when the disputed transaction has no vault identity', async () => {
    tableData['stripe_evidence_vault:single'] = null;

    const result = await stripeCe3Service.buildCe3Evidence({ merchant, disputeEvent: disputeEvent() });

    expect(result.evidence).toBeNull();
    expect(result.reasons[0]).toContain('No evidence vault entry');
  });

  test('fails cleanly when the dispute has no linked contact (never guess)', async () => {
    const result = await stripeCe3Service.buildCe3Evidence({
      merchant,
      disputeEvent: disputeEvent({ contact_id: null }),
    });

    expect(result.evidence).toBeNull();
    expect(result.reasons[0]).toContain('not linked to a client');
  });

  test('a prior without a charge id cannot be used (payload requires it)', async () => {
    tableData['stripe_evidence_vault'] = [
      vaultRow('pi_1', { stripe_charge_id: null }),
      vaultRow('pi_2'),
      vaultRow('pi_3'),
    ];

    const result = await stripeCe3Service.buildCe3Evidence({ merchant, disputeEvent: disputeEvent() });

    const charges = result.evidence!.prior_undisputed_transactions.map((t) => t.charge);
    expect(charges).not.toContain(null);
    expect(charges).toEqual(expect.arrayContaining(['ch_pi_2', 'ch_pi_3']));
  });
});

describe('getCe3Eligibility (stripe-dispute.service)', () => {
  // Import here so the same supabase/config/logger mocks apply
  const { stripeDisputeService } = require('../../src/services/stripe-dispute.service');

  test('reads eligibility + status + required actions from raw_dispute_object', () => {
    const de = {
      raw_dispute_object: {
        enhanced_eligibility_types: ['visa_compelling_evidence_3'],
        evidence_details: {
          enhanced_eligibility: {
            visa_compelling_evidence_3: { status: 'requires_action', required_actions: ['missing_merchandise_or_services'] },
          },
        },
      },
    };
    expect(stripeDisputeService.getCe3Eligibility(de)).toEqual({
      eligible: true,
      status: 'requires_action',
      requiredActions: ['missing_merchandise_or_services'],
    });
  });

  test('not eligible when the type is absent or raw object missing', () => {
    expect(stripeDisputeService.getCe3Eligibility({ raw_dispute_object: {} }).eligible).toBe(false);
    expect(stripeDisputeService.getCe3Eligibility(null).eligible).toBe(false);
  });
});
