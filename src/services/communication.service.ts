import { ghlApi } from '../clients/ghl.client';
import { evidenceService } from './evidence.service';
import { logger } from '../utils/logger';
import { EVIDENCE_TYPES } from '../constants/evidence-types';
import { buildDefenseEvidenceFields } from '../utils/defense-evidence';

function normalizeCommType(type: string): 'email' | 'sms' | 'call' | 'voicemail' | 'chat' | 'other' {
  const t = String(type || '').toLowerCase();
  if (t.includes('sms')) return 'sms';
  if (t.includes('email')) return 'email';
  if (t.includes('call')) return 'call';
  if (t.includes('voicemail')) return 'voicemail';
  if (t.includes('chat')) return 'chat';
  return 'other';
}

function communicationPurpose(summary: string, direction: string): string {
  const text = summary.toLowerCase();
  if (text.includes('refund')) return 'refund_discussion';
  if (text.includes('cancel')) return 'cancellation_discussion';
  if (text.includes('payment') || text.includes('card') || text.includes('invoice')) return 'billing_discussion';
  if (text.includes('login') || text.includes('access') || text.includes('session') || text.includes('module')) return 'service_access_or_delivery';
  return direction === 'inbound' ? 'client_engagement' : 'merchant_outreach';
}

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
          const type = normalizeCommType(msg.type || 'unknown');
          const summary = (msg.body || msg.text || '').slice(0, 500);
          const purpose = communicationPurpose(summary, direction);

          await evidenceService.logEvidence(
            EVIDENCE_TYPES.COMMUNICATION,
            locationId, contactId, 'ghl_conversations',
            {
              comm_type: type,
              direction,
              comm_date: msg.dateAdded || msg.createdAt,
              summary,
              body_preview: summary.slice(0, 200),
              ghl_message_id: msg.id,
              ghl_conversation_id: conv.id,
              raw_payload: msg,
              ...buildDefenseEvidenceFields({
                summary: `${direction === 'inbound' ? 'Client' : 'Merchant'} ${type} communication recorded. Purpose: ${purpose.replace(/_/g, ' ')}.${summary ? ` Excerpt: ${summary.slice(0, 180)}` : ''}`,
                title: `${direction === 'inbound' ? 'Client' : 'Merchant'} Communication`,
                proofRole: 'communication',
                relevance: {
                  tags: ['services_not_provided', 'not_as_described', 'credit_not_processed', 'cancelled_recurring', 'fraud'],
                  priority: direction === 'inbound' ? 'high' : 'medium',
                  confidence: 'moderate',
                },
                sourceRecordId: msg.id,
                metadata: {
                  actor: direction === 'inbound' ? 'client' : 'merchant',
                  communication: {
                    channel: type,
                    direction,
                    purpose,
                    excerpt: summary.slice(0, 300),
                    ghlConversationId: conv.id,
                    ghlMessageId: msg.id,
                  },
                  source: { system: 'ghl_conversations', recordId: msg.id, rawEventType: 'conversation_message' },
                },
              }),
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
        comm_type: normalizeCommType(type),
        direction: 'outbound',
        comm_date: new Date().toISOString(),
        summary,
        body_preview: summary.slice(0, 200),
        ...buildDefenseEvidenceFields({
          summary: `Merchant outbound ${normalizeCommType(type)} recorded. Purpose: ${communicationPurpose(summary, 'outbound').replace(/_/g, ' ')}.${summary ? ` Excerpt: ${summary.slice(0, 180)}` : ''}`,
          title: 'Outbound Communication',
          proofRole: 'communication',
          relevance: {
            tags: ['services_not_provided', 'not_as_described', 'credit_not_processed', 'cancelled_recurring'],
            priority: 'medium',
            confidence: 'moderate',
          },
          metadata: {
            actor: 'merchant',
            communication: {
              channel: normalizeCommType(type),
              direction: 'outbound',
              purpose: communicationPurpose(summary, 'outbound'),
              excerpt: summary.slice(0, 300),
            },
            source: { system: 'app_triggered', rawEventType: 'outbound_message' },
          },
        }),
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
        comm_type: normalizeCommType(type),
        direction: 'inbound',
        comm_date: receivedAt || new Date().toISOString(),
        summary,
        body_preview: summary.slice(0, 200),
        ...buildDefenseEvidenceFields({
          summary: `Client inbound ${normalizeCommType(type)} recorded. Purpose: ${communicationPurpose(summary, 'inbound').replace(/_/g, ' ')}.${summary ? ` Excerpt: ${summary.slice(0, 180)}` : ''}`,
          title: 'Inbound Client Communication',
          proofRole: 'communication',
          relevance: {
            tags: ['services_not_provided', 'not_as_described', 'credit_not_processed', 'cancelled_recurring', 'fraud'],
            priority: 'high',
            confidence: 'moderate',
          },
          metadata: {
            actor: 'client',
            communication: {
              channel: normalizeCommType(type),
              direction: 'inbound',
              purpose: communicationPurpose(summary, 'inbound'),
              excerpt: summary.slice(0, 300),
            },
            source: { system: 'ghl_webhook', rawEventType: 'inbound_message' },
          },
        }),
      },
    );
  },
};
