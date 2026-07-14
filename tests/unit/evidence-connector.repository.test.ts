const mockFrom = jest.fn();

jest.mock('../../src/clients/supabase.client', () => ({
  getSupabase: () => ({ from: mockFrom }),
}));

import { evidenceConnectorRepository } from '../../src/repositories/evidence-connector.repository';

describe('evidenceConnectorRepository.listEvents', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('loads offer names from offers_mirror instead of a nonexistent enrollment column', async () => {
    const result = { data: [], error: null };
    const chain: any = {
      select: jest.fn(() => chain),
      eq: jest.fn(() => chain),
      order: jest.fn(() => chain),
      limit: jest.fn(() => chain),
      then: (resolve: any) => resolve(result),
    };
    mockFrom.mockReturnValue(chain);

    await evidenceConnectorRepository.listEvents('loc_1', 'conn_1');

    expect(mockFrom).toHaveBeenCalledWith('external_evidence_events');
    expect(chain.select).toHaveBeenCalledWith(
      '*, enrollment:enrollments(id, contact_id, email, offer_id), offer:offers_mirror(id, offer_name)',
    );
    expect(chain.eq).toHaveBeenCalledWith('location_id', 'loc_1');
    expect(chain.eq).toHaveBeenCalledWith('connection_id', 'conn_1');
  });
});
