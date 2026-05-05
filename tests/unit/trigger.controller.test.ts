import { triggerController } from '../../src/controllers/trigger.controller';

const mockUpsertSubscription = jest.fn();
const mockDeactivateSubscription = jest.fn();

jest.mock('../../src/repositories/trigger.repository', () => ({
  triggerRepository: {
    upsertSubscription: (...args: any[]) => mockUpsertSubscription(...args),
    deactivateSubscription: (...args: any[]) => mockDeactivateSubscription(...args),
  },
}));

function createRes() {
  return {
    json: jest.fn(),
  } as any;
}

describe('triggerController.handleSubscription', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUpsertSubscription.mockResolvedValue({});
    mockDeactivateSubscription.mockResolvedValue(undefined);
  });

  it('subscribes using the current HighLevel Marketplace trigger payload shape', async () => {
    const req = {
      body: {
        triggerData: {
          key: 'enrollment_complete',
          eventType: 'CREATED',
          targetUrl: 'https://services.leadconnectorhq.com/workflows-marketplace/triggers/execute/app/workflow',
        },
        meta: { key: 'enrollment_complete', version: '1.0' },
        extras: { locationId: 'loc_123', workflowId: 'wf_123', companyId: 'company_123' },
      },
    } as any;
    const res = createRes();
    const next = jest.fn();

    await triggerController.handleSubscription(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(mockUpsertSubscription).toHaveBeenCalledWith(
      'loc_123',
      'enrollment_complete',
      'https://services.leadconnectorhq.com/workflows-marketplace/triggers/execute/app/workflow',
    );
    expect(res.json).toHaveBeenCalledWith({ success: true });
  });

  it('unsubscribes when HighLevel sends DELETED', async () => {
    const req = {
      body: {
        triggerData: {
          key: 'ss_payment_received',
          eventType: 'DELETED',
          targetUrl: 'https://services.leadconnectorhq.com/workflows-marketplace/triggers/execute/app/workflow',
        },
        extras: { locationId: 'loc_123' },
      },
    } as any;
    const res = createRes();
    const next = jest.fn();

    await triggerController.handleSubscription(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(mockDeactivateSubscription).toHaveBeenCalledWith(
      'loc_123',
      'ss_payment_received',
      'https://services.leadconnectorhq.com/workflows-marketplace/triggers/execute/app/workflow',
    );
    expect(res.json).toHaveBeenCalledWith({ success: true });
  });
});
