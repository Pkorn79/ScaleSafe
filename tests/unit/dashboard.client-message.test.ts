const mockFrom = jest.fn();
const mockGhlPost = jest.fn();
const mockLogOutboundMessage = jest.fn();

jest.mock('../../src/clients/supabase.client', () => ({
  getSupabase: () => ({ from: mockFrom }),
}));
jest.mock('../../src/clients/ghl.client', () => ({
  ghlApi: jest.fn(async () => ({ post: mockGhlPost })),
}));
jest.mock('../../src/services/communication.service', () => ({
  communicationService: {
    logOutboundMessage: (...args: any[]) => mockLogOutboundMessage(...args),
  },
}));
jest.mock('../../src/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import { dashboardController } from '../../src/controllers/dashboard.controller';

function enrollmentQuery(data: any[]) {
  const result = { data, error: null };
  const chain: any = {
    select: jest.fn(() => chain),
    eq: jest.fn(() => chain),
    in: jest.fn(() => chain),
    then: (resolve: any) => resolve(result),
  };
  return chain;
}

function response() {
  return { json: jest.fn(), status: jest.fn().mockReturnThis() };
}

describe('dashboardController.sendClientMessage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGhlPost.mockResolvedValue({ data: { messageId: 'msg_1', conversationId: 'conv_1' } });
    mockLogOutboundMessage.mockResolvedValue(undefined);
  });

  it('auto-links the only active enrollment and records the GHL identifiers', async () => {
    const query = enrollmentQuery([{ id: 'enr_1', offer_id: 'offer_1', status: 'enrolled' }]);
    mockFrom.mockReturnValue(query);
    const req: any = {
      params: {},
      tenantContext: { locationId: 'loc_1' },
      body: { contactId: 'contact_1', type: 'email', message: 'Hello client' },
    };
    const res = response();
    const next = jest.fn();

    await dashboardController.sendClientMessage(req, res as any, next);

    expect(next).not.toHaveBeenCalled();
    expect(query.eq).toHaveBeenCalledWith('location_id', 'loc_1');
    expect(query.eq).toHaveBeenCalledWith('contact_id', 'contact_1');
    expect(mockLogOutboundMessage).toHaveBeenCalledWith(
      'loc_1', 'contact_1', 'email', 'Hello client',
      expect.objectContaining({ enrollmentId: 'enr_1', ghlMessageId: 'msg_1', ghlConversationId: 'conv_1' }),
    );
    expect(res.json).toHaveBeenCalledWith({
      success: true, enrollmentId: 'enr_1', messageId: 'msg_1', evidenceLogged: true,
    });
  });

  it('requires a program choice when the client has multiple active enrollments', async () => {
    mockFrom.mockReturnValue(enrollmentQuery([
      { id: 'enr_1', status: 'enrolled' },
      { id: 'enr_2', status: 'active' },
    ]));
    const req: any = {
      params: {},
      tenantContext: { locationId: 'loc_1' },
      body: { contactId: 'contact_1', type: 'sms', message: 'Hello' },
    };
    const res = response();
    const next = jest.fn();

    await dashboardController.sendClientMessage(req, res as any, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: 'Select the program this message relates to' }));
    expect(mockGhlPost).not.toHaveBeenCalled();
  });

  it('does not invite a duplicate resend when evidence logging fails after GHL sends', async () => {
    mockFrom.mockReturnValue(enrollmentQuery([{ id: 'enr_1', status: 'enrolled' }]));
    mockLogOutboundMessage.mockRejectedValueOnce(new Error('database unavailable'));
    const req: any = {
      params: {},
      tenantContext: { locationId: 'loc_1' },
      body: { contactId: 'contact_1', type: 'sms', message: 'Hello', enrollmentId: 'enr_1' },
    };
    const res = response();
    const next = jest.fn();

    await dashboardController.sendClientMessage(req, res as any, next);

    expect(next).not.toHaveBeenCalled();
    expect(mockGhlPost).toHaveBeenCalledTimes(1);
    expect(res.json).toHaveBeenCalledWith({
      success: true, enrollmentId: 'enr_1', messageId: 'msg_1', evidenceLogged: false,
    });
  });
});
