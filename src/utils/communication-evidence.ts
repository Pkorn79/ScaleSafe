export type CommunicationDirection = 'inbound' | 'outbound';
export type CommunicationType = 'email' | 'sms' | 'call' | 'voicemail' | 'chat' | 'other';

export interface CommunicationEvidenceSummaryInput {
  direction: CommunicationDirection;
  channel: CommunicationType;
  sourceChannel?: string;
  subject?: string | null;
  body?: string | null;
  conversationId?: string | null;
  messageId?: string | null;
}

export interface CommunicationEvidenceSummary {
  direction: CommunicationDirection;
  channel: CommunicationType;
  sourceChannel: string;
  nature: string;
  natureLabel: string;
  cleanBody: string;
  preview: string;
  summary: string;
  title: string;
  actorLabel: string;
}

const ENTITY_MAP: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

function decodeHtmlEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (_, entity: string) => {
    const key = entity.toLowerCase();
    if (key[0] === '#') {
      const hex = key.startsWith('#x');
      const parsed = Number.parseInt(key.slice(hex ? 2 : 1), hex ? 16 : 10);
      return Number.isFinite(parsed) ? String.fromCodePoint(parsed) : '';
    }
    return ENTITY_MAP[key] ?? `&${entity};`;
  });
}

export function stripHtmlToText(value: string): string {
  return decodeHtmlEntities(String(value || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/?(br|p|div|li|tr|td|table|h[1-6])\b[^>]*>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim());
}

export function cleanCommunicationBody(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value !== 'string' || !value.trim()) continue;
    const cleaned = stripHtmlToText(value);
    if (cleaned) return cleaned;
  }
  return '';
}

export function normalizeCommunicationDirection(value: unknown): CommunicationDirection {
  const v = String(value || '').toLowerCase();
  if (v.includes('inbound') || v === '1' || v === 'incoming') return 'inbound';
  return 'outbound';
}

export function normalizeCommunicationChannel(value: unknown): CommunicationType {
  const v = String(value || '').toLowerCase();
  if (v.includes('email')) return 'email';
  if (v.includes('sms') || v.includes('text')) return 'sms';
  if (v.includes('call') || v.includes('phone')) return 'call';
  if (v.includes('voicemail')) return 'voicemail';
  if (v.includes('chat') || v.includes('whatsapp') || v.includes('facebook') || v.includes('fb') || v.includes('instagram') || v.includes('ig') || v.includes('gmb') || v.includes('message')) return 'chat';
  return 'other';
}

export function normalizeCommunicationSourceChannel(value: unknown): string {
  const v = String(value || '').toLowerCase();
  if (v.includes('whatsapp')) return 'WhatsApp';
  if (v.includes('facebook') || v === 'fb' || v.includes('type_fb')) return 'Facebook';
  if (v.includes('instagram') || v === 'ig' || v.includes('type_ig')) return 'Instagram';
  if (v.includes('gmb') || v.includes('google')) return 'Google Business';
  if (v.includes('email')) return 'Email';
  if (v.includes('sms') || v.includes('text')) return 'SMS';
  if (v.includes('call')) return 'Call';
  if (v.includes('voicemail')) return 'Voicemail';
  if (v.includes('chat')) return 'Chat';
  return value ? String(value).replace(/^TYPE_/, '').replace(/_/g, ' ') : 'GHL';
}

function classifyNature(subject: string, body: string, direction: CommunicationDirection): { nature: string; label: string } {
  const text = `${subject} ${body}`.toLowerCase();
  if (text.includes('payment receipt') || (text.includes('payment') && (text.includes('confirms') || text.includes('received your payment') || text.includes('receipt')))) return { nature: 'payment_receipt', label: 'Payment receipt' };
  if (text.includes('enrollment link') || text.includes('complete your enrollment') || text.includes('secure enrollment')) return { nature: 'enrollment_link', label: 'Enrollment link' };
  if (text.includes('milestone') && (text.includes('sign-off') || text.includes('signoff') || text.includes('sign off'))) return { nature: 'milestone_signoff', label: 'Milestone sign-off request' };
  if (text.includes('upcoming payment') || text.includes('payment reminder') || text.includes('next payment')) return { nature: 'payment_reminder', label: 'Payment reminder' };
  if (text.includes('refund')) return { nature: 'refund_notice', label: 'Refund communication' };
  if (text.includes('cancel')) return { nature: 'cancellation', label: 'Cancellation communication' };
  if (direction === 'inbound') return { nature: 'client_reply', label: 'Client reply' };
  return { nature: 'merchant_message', label: 'Merchant message' };
}

export function buildCommunicationEvidenceSummary(input: CommunicationEvidenceSummaryInput): CommunicationEvidenceSummary {
  const directionLabel = input.direction === 'inbound' ? 'Inbound from client' : 'Outbound to client';
  const sourceChannel = input.sourceChannel || normalizeCommunicationSourceChannel(input.channel);
  const cleanBody = cleanCommunicationBody(input.body || '');
  const subject = cleanCommunicationBody(input.subject || '');
  const { nature, label } = classifyNature(subject, cleanBody, input.direction);
  const preview = cleanBody.slice(0, 240);
  const idPart = input.conversationId ? ` - GHL conversation ${String(input.conversationId).slice(0, 10)}` : '';
  const summary = `${directionLabel} - ${sourceChannel} - ${label}${idPart}${preview ? `. Preview: ${preview}` : '.'}`;
  return {
    direction: input.direction,
    channel: input.channel,
    sourceChannel,
    nature,
    natureLabel: label,
    cleanBody,
    preview,
    summary,
    title: `${directionLabel} ${sourceChannel}`,
    actorLabel: input.direction === 'inbound' ? 'client' : 'merchant',
  };
}

export function looksLikeHtml(value: unknown): boolean {
  return typeof value === 'string' && /<\/?[a-z][\s\S]*>/i.test(value);
}
