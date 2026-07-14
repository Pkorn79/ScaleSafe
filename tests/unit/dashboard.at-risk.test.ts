const getAtRiskClients = jest.fn();
const checkAllClients = jest.fn();

jest.mock('../../src/services/disengagement.service', () => ({
  disengagementService: {
    getAtRiskClients: (...args: any[]) => getAtRiskClients(...args),
    checkAllClients: (...args: any[]) => checkAllClients(...args),
    scoreClient: jest.fn(),
  },
}));

import { dashboardController } from '../../src/controllers/dashboard.controller';

beforeEach(() => {
  jest.clearAllMocks();
});

describe('dashboardController.atRisk', () => {
  test('uses the read-only scorer and never runs disengagement side effects', async () => {
    getAtRiskClients.mockResolvedValue([
      {
        contactId: 'contact_1',
        riskScore: 55,
        riskFactors: ['2 consecutive no-shows'],
        daysInactive: 7,
        flagged: true,
      },
    ]);
    const req = { params: { locationId: 'loc_1' }, query: {} } as any;
    const res = { json: jest.fn() } as any;
    const next = jest.fn();

    await dashboardController.atRisk(req, res, next);

    expect(getAtRiskClients).toHaveBeenCalledWith('loc_1');
    expect(checkAllClients).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({
      count: 1,
      clients: [{
        contactId: 'contact_1',
        riskScore: 55,
        riskFactors: ['2 consecutive no-shows'],
        daysInactive: 7,
      }],
    });
    expect(next).not.toHaveBeenCalled();
  });
});
