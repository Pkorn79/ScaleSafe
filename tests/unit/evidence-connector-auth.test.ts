jest.mock('../../src/repositories/evidence-connector.repository', () => ({
  evidenceConnectorRepository: {
    findCredentialByHash: jest.fn(),
    consumeRateLimit: jest.fn(),
    touchCredential: jest.fn(),
  },
}));

import { requireCanonicalEvidenceApiKey } from '../../src/middleware/evidenceConnectorAuth';
import { evidenceConnectorRepository } from '../../src/repositories/evidence-connector.repository';

describe('evidence connector authentication', () => {
  beforeEach(() => jest.clearAllMocks());

  it('derives tenant from the credential and ignores a claimed payload location', async () => {
    (evidenceConnectorRepository.findCredentialByHash as jest.Mock).mockResolvedValue({
      credential: { id: 'cred-1', credential_type: 'api_key' },
      connection: {
        id: 'conn-1', location_id: 'location-a', status: 'active', connection_type: 'canonical_api', rate_limit_per_minute: 300,
      },
    });
    (evidenceConnectorRepository.consumeRateLimit as jest.Mock).mockResolvedValue(true);
    (evidenceConnectorRepository.touchCredential as jest.Mock).mockResolvedValue(undefined);
    const req: any = {
      headers: { authorization: 'Bearer ss_ev_secret' },
      body: { location_id: 'location-b' },
    };
    const res: any = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();

    await requireCanonicalEvidenceApiKey(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.evidenceConnector.connection.location_id).toBe('location-a');
    expect(req.evidenceConnector.connection.location_id).not.toBe(req.body.location_id);
  });

  it('rejects an invalid key before intake', async () => {
    (evidenceConnectorRepository.findCredentialByHash as jest.Mock).mockResolvedValue(null);
    const req: any = { headers: { authorization: 'Bearer invalid' } };
    const res: any = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();

    await requireCanonicalEvidenceApiKey(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });
});
