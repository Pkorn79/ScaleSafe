const mockListConnections = jest.fn();
const mockConnectionEventSummary = jest.fn();

jest.mock('../../src/config', () => ({ config: { appUrl: 'https://dashboard.scalesafe.app' } }));
jest.mock('../../src/repositories/evidence-connector.repository', () => ({
  evidenceConnectorRepository: {
    listConnections: (...args: any[]) => mockListConnections(...args),
    connectionEventSummary: (...args: any[]) => mockConnectionEventSummary(...args),
  },
}));
jest.mock('../../src/repositories/merchant.repository', () => ({ merchantRepository: {} }));
jest.mock('../../src/repositories/offer.repository', () => ({ offerRepository: {} }));
jest.mock('../../src/services/evidence-connector.service', () => ({ evidenceConnectorService: {} }));

import { evidenceConnectionService } from '../../src/services/evidence-connection.service';

describe('merchant evidence connection status', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('does not present a diagnostic test timestamp as published evidence', async () => {
    mockListConnections.mockResolvedValue([{
      id: 'conn_1', name: 'Zoom', source_label: 'Zoom', provider_key: 'zoom',
      connection_type: 'provider_oauth', status: 'disabled', setup_status: 'testing',
      health_status: 'ready', last_success_at: '2026-07-10T12:00:00Z', last_event_at: null,
      last_error_message: null,
    }]);
    mockConnectionEventSummary.mockResolvedValue([]);

    const [connection] = await evidenceConnectionService.list('loc_1');

    expect(connection.lastEvidenceAt).toBeNull();
    expect(connection.needsAttention).toBe(true);
    expect(connection.statusMessage).toBe('Connection is disabled.');
  });

  it('reports a real published event as evidence for an active connection', async () => {
    mockListConnections.mockResolvedValue([{
      id: 'conn_2', name: 'Zoom', source_label: 'Zoom', provider_key: 'zoom',
      connection_type: 'provider_oauth', status: 'active', setup_status: 'active',
      health_status: 'ready', last_success_at: '2026-07-10T12:00:00Z', last_event_at: '2026-07-11T12:00:00Z',
      last_error_message: null,
    }]);
    mockConnectionEventSummary.mockResolvedValue([{
      status: 'published', offer_id: 'offer_1', published_at: '2026-07-11T12:00:00Z',
      offer: { id: 'offer_1', offer_name: 'Program One' },
    }]);

    const [connection] = await evidenceConnectionService.list('loc_1');

    expect(connection.lastEvidenceAt).toBe('2026-07-11T12:00:00Z');
    expect(connection.needsAttention).toBe(false);
    expect(connection.authorizationStatus).toBe('not_connected');
    expect(connection.webhookStatus).toBe('observed');
    expect(connection.evidenceStatus).toBe('published');
    expect(connection.affectedPrograms).toEqual([{ offerId: 'offer_1', offerName: 'Program One' }]);
  });

  it('separates OAuth readiness from webhook and evidence proof', async () => {
    mockListConnections.mockResolvedValue([{
      id: 'conn_3', name: 'Zoom', source_label: 'Zoom', provider_key: 'zoom',
      connection_type: 'provider_adapter', status: 'active', setup_status: 'active',
      health_status: 'healthy', external_account_id: 'zoom-account', last_event_at: null,
      last_error_message: null,
    }]);
    mockConnectionEventSummary.mockResolvedValue([]);

    const [connection] = await evidenceConnectionService.list('loc_1');

    expect(connection.healthStatus).toBe('ready');
    expect(connection.authorizationStatus).toBe('connected');
    expect(connection.webhookStatus).toBe('awaiting_test');
    expect(connection.evidenceStatus).toBe('awaiting_evidence');
    expect(connection.needsAttention).toBe(false);
    expect(connection.statusMessage).toContain('Waiting for a completed participant session');
  });
});
