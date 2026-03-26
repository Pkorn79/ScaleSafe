import { ghlApi } from '../clients/ghl.client';
import { evidenceService } from './evidence.service';
import { logger } from '../utils/logger';
import { EVIDENCE_TYPES } from '../constants/evidence-types';

/**
 * Communication logging — P0 priority per v2.1 spec.
 * Inbound client messages are Tier 1 chargeback evidence.
 * Pulls GHL conversation history for both outbound and inbound communications.
 */
export const communicationService = {
  /**
   * Pull and log recent conversations for a contact from GHL.
   * Logs each message as communication evidence.
   */
  async pullConversations(locationId: string, contactId: string): Promise<number> {
    const api = await ghlApi(locationId);
    let logged = 0;

    try {
      // Get conversations for the contact
      const convRes = await api.get('/conversations/search', {
        params: { locationId, contactId },
      });

      const conversations = convRes.data.conversations || [];

      for (const conv of conversations) {
        // Get messages for each conversation
        const msgRes = await api.get(`/conversations/${conv.id}/messages`, {
          params: { limit: 50 },
        });

        const messages = msgRes.data.messages || [];

        for (const msg of messages) {
          const direction = msg.direction === 1 ? 'inbound' : 'outbound';
          const type = msg.type || 'unknown'; // SMS, Email, etc.

          await evidenceService.logEvidence(
            EVIDENCE_TYPES.COMMUNICATION,
            locationId, contactId, 'ghl_conversations',
            {
              comm_type: type,
              direction,
              comm_date: msg.dateAdded || msg.createdAt,
              summary: (msg.body || msg.text || '').slice(0, 500),
              message_id: msg.id,
              conversation_id: conv.id,
            },
          );
          logged++;
        }
      }
    } catch (err) {
      logger.warn({ err, contactId, locationId }, 'Failed to pull GHL conversations');
    }

    logger.info({ contactId, locationId, messagesLogged: logged }, 'Communication history pulled');
    return logged;
  },

  /**
   * Log a single outbound message as evidence.
   * Called when the app triggers a GHL workflow that sends a message.
   */
  async logOutboundMessage(
    locationId: string,
    contactId: string,
    type: string,
    summary: string,
  ): Promise<void> {
    await evidenceService.logEvidence(
      EVIDENCE_TYPES.COMMUNICATION,
      locationId, contactId, 'app_triggered',
      {
        comm_type: type,
        direction: 'outbound',
        comm_date: new Date().toISOString(),
        summary,
      },
    );
  },

  /**
   * Log an inbound message as evidence.
   * Called when receiving a webhook about client communication.
   */
  async logInboundMessage(
    locationId: string,
    contactId: string,
    type: string,
    summary: string,
    receivedAt?: string,
  ): Promise<void> {
    await evidenceService.logEvidence(
      EVIDENCE_TYPES.COMMUNICATION,
      locationId, contactId, 'ghl_webhook',
      {
        comm_type: type,
        direction: 'inbound',
        comm_date: receivedAt || new Date().toISOString(),
        summary,
      },
    );
  },
};
