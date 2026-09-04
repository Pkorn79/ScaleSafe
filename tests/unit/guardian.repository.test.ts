const rpc = jest.fn();

jest.mock('../../src/clients/supabase.client', () => ({
  getSupabase: () => ({ rpc }),
}));

import { guardianRepository } from '../../src/repositories/guardian.repository';

describe('guardianRepository', () => {
  beforeEach(() => {
    rpc.mockReset();
  });

  it('preserves the exact signed sequence when PostgREST rounds a BIGINT', async () => {
    rpc.mockResolvedValue({
      data: [{
        decision: 'accepted',
        receipt_id: '00000000-0000-4000-8000-000000009901',
        original_receipt_id: null,
        accepted_sequence: 9223372036854776000,
        accepted_observation_count: 0,
        record_id: null,
        rejection_code: null,
        server_time: '2026-08-03T15:00:00.000Z',
      }],
      error: null,
    });

    const sequence = '9223372036854775807';
    const claim = await guardianRepository.claimRequest({
      authentication: {
        credential: {
          id: '00000000-0000-4000-8000-000000009900',
          keyId: '00000000-0000-4000-8000-000000000001',
          instanceId: '00000000-0000-4000-8000-000000001001',
          publicKey: Buffer.alloc(32),
          status: 'active',
          validFrom: '2026-08-03T14:00:00.000Z',
          validUntil: '2026-08-03T16:00:00.000Z',
        },
        exactPath: '/internal/guardian/v1/snapshot',
        method: 'GET',
        timestampSeconds: '1785769200',
        sequence,
        bodySha256:
          'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        rawBody: Buffer.alloc(0),
      },
      payload: null,
    });

    expect(claim.acceptedSequence).toBe(sequence);
    expect(rpc).toHaveBeenCalledWith('claim_guardian_request', expect.objectContaining({
      p_sequence: sequence,
    }));
  });
});
