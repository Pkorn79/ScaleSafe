import {
  DefenseDisputeRelevance,
  DefenseEvidenceFields,
  DefenseEvidenceMetadata,
  DefenseProofRole,
  DefenseReasonCodeTag,
} from '../types/defense-evidence.types';

const VALID_REASON_TAGS: ReadonlySet<string> = new Set([
  'authorization',
  'fraud',
  'services_not_provided',
  'not_as_described',
  'credit_not_processed',
  'cancelled_recurring',
  'duplicate_processing',
  'unrecognized',
  'general',
]);

export function normalizeReasonCodeTags(tags: unknown): DefenseReasonCodeTag[] {
  if (!Array.isArray(tags)) return [];

  const out: DefenseReasonCodeTag[] = [];
  const seen = new Set<string>();
  for (const raw of tags) {
    const tag = String(raw || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
    if (!VALID_REASON_TAGS.has(tag) || seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag as DefenseReasonCodeTag);
  }
  return out;
}

export function buildDefenseEvidenceFields(input: {
  summary: string;
  title?: string | null;
  proofRole: DefenseProofRole;
  relevance?: DefenseDisputeRelevance | null;
  metadata?: DefenseEvidenceMetadata | null;
  enrollmentId?: string | null;
  paymentEventId?: string | null;
  sourceRecordId?: string | null;
  actor?: DefenseEvidenceFields['actor'];
}): DefenseEvidenceFields {
  const reasonTags = normalizeReasonCodeTags(input.relevance?.tags);

  return {
    enrollment_id: input.enrollmentId ?? input.metadata?.service?.enrollmentId ?? null,
    payment_event_id: input.paymentEventId ?? input.metadata?.transaction?.paymentEventId ?? null,
    defense_summary: input.summary,
    issuer_exhibit_title: input.title || input.summary,
    proof_role: input.proofRole,
    reason_code_tags: reasonTags.length > 0 ? reasonTags : null,
    dispute_relevance: input.relevance || null,
    source_record_id: input.sourceRecordId ?? input.metadata?.source?.recordId ?? null,
    actor: input.actor ?? input.metadata?.actor ?? null,
    defense_metadata: input.metadata || null,
  };
}

export function getDefenseSummary(row: Record<string, any>): string {
  return (
    row.defense_summary ||
    row.description ||
    row.summary ||
    row.data?.defense_summary ||
    row.data?.description ||
    row.data?.summary ||
    ''
  );
}
