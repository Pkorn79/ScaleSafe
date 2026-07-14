const mockLogEvidence = jest.fn();

jest.mock('../../src/services/evidence.service', () => ({
  evidenceService: { logEvidence: (...args: any[]) => mockLogEvidence(...args) },
}));
jest.mock('../../src/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import { communicationService } from '../../src/services/communication.service';

describe('communicationService.logOutboundMessage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLogEvidence.mockResolvedValue(undefined);
  });

  it('persists the selected enrollment and provider message identifiers', async () => {
    await communicationService.logOutboundMessage('loc_1', 'contact_1', 'email', 'Progress update', {
      enrollmentId: 'enr_1',
      subject: 'Weekly update',
      ghlMessageId: 'msg_1',
      ghlConversationId: 'conv_1',
    });

    expect(mockLogEvidence).toHaveBeenCalledWith(
      'communication', 'loc_1', 'contact_1', 'app_triggered',
      expect.objectContaining({
        enrollment_id: 'enr_1',
        subject: 'Weekly update',
        ghl_message_id: 'msg_1',
        ghl_conversation_id: 'conv_1',
        source_record_id: 'msg_1',
      }),
    );
  });
});
