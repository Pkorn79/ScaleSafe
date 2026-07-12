const mockFrom = jest.fn();

jest.mock('../../src/clients/supabase.client', () => ({
  getSupabase: () => ({ from: (...args: any[]) => mockFrom(...args) }),
}));

import {
  providerOutcomeResolutionService,
  validateProviderOutcomeResolution,
} from '../../src/services/provider-outcome-resolution.service';

function targetTable(row: Record<string, any>, options: { auditError?: any } = {}) {
  const updates: Record<string, any>[] = [];
  const audits: Record<string, any>[] = [];
  mockFrom.mockImplementation((table: string) => {
    if (table === 'hq_admin_audit_logs') {
      return {
        insert: jest.fn((payload: Record<string, any>) => {
          audits.push(payload);
          return Promise.resolve({ error: options.auditError || null });
        }),
      };
    }
    return {
      select: jest.fn(() => ({
        eq: jest.fn(() => ({
          maybeSingle: jest.fn().mockResolvedValue({ data: row, error: null }),
        })),
      })),
      update: jest.fn((payload: Record<string, any>) => {
        updates.push(payload);
        const chain: any = {
          eq: jest.fn(() => chain),
          select: jest.fn(() => chain),
          maybeSingle: jest.fn().mockResolvedValue({
            data: { id: row.id, location_id: row.location_id, ...payload },
            error: null,
          }),
        };
        return chain;
      }),
    };
  });
  return { updates, audits };
}

const baseInput = {
  id: 'claim_123',
  adminLabel: 'operator@example.com',
  ipAddress: '127.0.0.1',
  userAgent: 'jest',
};

describe('providerOutcomeResolutionService', () => {
  beforeEach(() => mockFrom.mockReset());

  it('turns a verified not-processed money outcome into a retryable pre-provider failure', async () => {
    const { updates, audits } = targetTable({
      id: 'claim_123',
      location_id: 'loc_a',
      operation_type: 'checkout_charge',
      processor_type: 'stripe',
      status: 'unknown',
    });

    const result = await providerOutcomeResolutionService.resolve({
      ...baseInput,
      kind: 'money_operation',
      resolution: 'not_processed',
      confirmation: 'CONFIRM NOT PROCESSED',
    });

    expect(result).toMatchObject({ locationId: 'loc_a', status: 'failed', resolution: 'not_processed' });
    expect(updates[0]).toMatchObject({ status: 'failed', provider_called: false, provider_started_at: null });
    expect(audits).toHaveLength(2);
    expect(audits[0]).toMatchObject({ target_location_id: 'loc_a', target_id: 'claim_123' });
  });

  it('moves a verified refund outcome to provider_accepted for local reconciliation', async () => {
    const { updates } = targetTable({
      id: 'claim_123',
      location_id: 'loc_b',
      processor: 'whop',
      status: 'unknown',
    });

    await providerOutcomeResolutionService.resolve({
      ...baseInput,
      kind: 'refund_claim',
      resolution: 'provider_accepted',
      confirmation: 'CONFIRM PROVIDER ACCEPTED',
      providerReference: 'rf_verified_123',
    });

    expect(updates[0]).toMatchObject({
      status: 'provider_accepted',
      provider_called: true,
      processor_refund_id: 'rf_verified_123',
    });
  });

  it('releases a Query URL refund fingerprint only after not-processed verification', async () => {
    const { updates } = targetTable({
      id: 'claim_123',
      location_id: 'loc_b',
      processor: 'nmi',
      claimed_by: 'query_url',
      request_fingerprint: 'stable-refund-request',
      status: 'unknown',
    });

    await providerOutcomeResolutionService.resolve({
      ...baseInput,
      kind: 'refund_claim',
      resolution: 'not_processed',
      confirmation: 'CONFIRM NOT PROCESSED',
    });

    expect(updates[0]).toMatchObject({ status: 'failed', request_fingerprint: null });
  });

  it('requires a recoverable Stripe response before accepting an ambiguous ACH intent', async () => {
    const { updates, audits } = targetTable({
      id: 'claim_123',
      location_id: 'loc_a',
      operation_type: 'checkout_ach_intent',
      processor_type: 'stripe',
      status: 'unknown',
    });

    await expect(providerOutcomeResolutionService.resolve({
      ...baseInput,
      kind: 'money_operation',
      resolution: 'provider_accepted',
      confirmation: 'CONFIRM PROVIDER ACCEPTED',
      providerReference: 'pi_123',
    })).rejects.toThrow('clientSecret');
    expect(updates).toHaveLength(0);
    expect(audits).toHaveLength(0);
  });

  it('binds a processor-confirmed recurring subscription to the exact enrollment', async () => {
    const { updates, audits } = targetTable({
      id: 'claim_123',
      location_id: 'loc_a',
      offer_name: 'Coaching Program',
      processor_type: 'stripe',
      processor_subscription_id: null,
      billing_setup_status: 'needs_reconciliation',
    });

    const result = await providerOutcomeResolutionService.resolve({
      ...baseInput,
      kind: 'billing_setup',
      resolution: 'provider_accepted',
      confirmation: 'CONFIRM PROVIDER ACCEPTED',
      providerReference: 'sub_verified_123',
      nextBillingDate: '2026-08-12',
    });

    expect(result).toMatchObject({ locationId: 'loc_a', status: 'ok' });
    expect(updates[0]).toMatchObject({
      billing_setup_status: 'ok',
      processor_subscription_id: 'sub_verified_123',
      next_billing_date: '2026-08-12',
    });
    expect(audits[0]).toMatchObject({ target_location_id: 'loc_a', target_type: 'billing_setup' });
  });

  it('refuses to mutate when the durable audit record cannot be written', async () => {
    const { updates } = targetTable({
      id: 'claim_123',
      location_id: 'loc_a',
      operation_type: 'checkout_charge',
      processor_type: 'stripe',
      status: 'unknown',
    }, { auditError: { message: 'audit unavailable' } });

    await expect(providerOutcomeResolutionService.resolve({
      ...baseInput,
      kind: 'money_operation',
      resolution: 'not_processed',
      confirmation: 'CONFIRM NOT PROCESSED',
    })).rejects.toThrow('audit unavailable');
    expect(updates).toHaveLength(0);
  });

  it('requires the explicit confirmation phrase', () => {
    expect(() => validateProviderOutcomeResolution({
      ...baseInput,
      kind: 'defense_submission',
      resolution: 'not_processed',
      confirmation: 'yes',
    })).toThrow('CONFIRM NOT PROCESSED');
  });
});
