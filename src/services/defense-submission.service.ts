import crypto from 'crypto';
import { getSupabase } from '../clients/supabase.client';
import { ConflictError, NotFoundError } from '../utils/errors';
import { logger } from '../utils/logger';

export interface DefenseSubmissionClaim {
  id: string;
  location_id: string;
  defense_packet_id: string;
  dispute_event_id: string | null;
  request_fingerprint: string;
  status: 'processing' | 'provider_accepted' | 'submitted' | 'failed' | 'unknown';
  provider_called: boolean;
  provider_reference: string | null;
  error_message: string | null;
  claimed_at?: string | null;
}

export type DefenseSubmissionBeginResult =
  | { action: 'execute'; claim: DefenseSubmissionClaim }
  | { action: 'replay'; claim: DefenseSubmissionClaim }
  | { action: 'blocked'; claim: DefenseSubmissionClaim };

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((result, key) => {
        result[key] = canonicalize((value as Record<string, unknown>)[key]);
        return result;
      }, {});
  }
  return value;
}

function fingerprint(value: unknown): string {
  return crypto.createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex');
}

function migrationError(error: any): Error {
  if (error?.code === '42P01' || String(error?.message || '').includes('defense_submission_claims')) {
    return new Error('Defense submission safeguards are not installed. Apply migration 098 before submitting a packet.');
  }
  return error;
}

async function requireUpdatedRow(query: PromiseLike<any>, description: string): Promise<any> {
  const { data, error } = await query;
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error(`${description} was not updated`);
  return row;
}

export const defenseSubmissionService = {
  fingerprint,

  async begin(input: {
    locationId: string;
    defensePacketId: string;
    disputeEventId?: string | null;
    request: unknown;
  }): Promise<DefenseSubmissionBeginResult> {
    const requestFingerprint = fingerprint(input.request);
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('defense_submission_claims')
      .insert({
        location_id: input.locationId,
        defense_packet_id: input.defensePacketId,
        dispute_event_id: input.disputeEventId || null,
        request_fingerprint: requestFingerprint,
        status: 'processing',
        provider_called: false,
      })
      .select('*')
      .single();

    if (!error && data) return { action: 'execute', claim: data as DefenseSubmissionClaim };
    if (error?.code !== '23505') throw migrationError(error);

    const { data: existing, error: existingError } = await supabase
      .from('defense_submission_claims')
      .select('*')
      .eq('location_id', input.locationId)
      .eq('defense_packet_id', input.defensePacketId)
      .maybeSingle();
    if (existingError) throw migrationError(existingError);
    if (!existing) throw new ConflictError('Defense submission is already processing.');
    if (existing.status === 'submitted') return { action: 'replay', claim: existing as DefenseSubmissionClaim };

    const claimedAt = existing.claimed_at ? new Date(existing.claimed_at).getTime() : NaN;
    if (
      existing.status === 'processing'
      && !existing.provider_called
      && Number.isFinite(claimedAt)
      && claimedAt <= Date.now() - 5 * 60 * 1000
    ) {
      const { data: reclaimed, error: reclaimError } = await supabase
        .from('defense_submission_claims')
        .update({
          request_fingerprint: requestFingerprint,
          dispute_event_id: input.disputeEventId || null,
          claimed_at: new Date().toISOString(),
          error_message: null,
        })
        .eq('id', existing.id)
        .eq('location_id', input.locationId)
        .eq('status', 'processing')
        .eq('provider_called', false)
        .eq('claimed_at', existing.claimed_at)
        .select('*')
        .maybeSingle();
      if (reclaimError) throw migrationError(reclaimError);
      if (reclaimed) return { action: 'execute', claim: reclaimed as DefenseSubmissionClaim };
    }

    // A failure proven to have happened before any provider call is safe to
    // retry, including after a merchant edits or regenerates the packet.
    if (existing.status === 'failed' && !existing.provider_called) {
      const { data: retried, error: retryError } = await supabase
        .from('defense_submission_claims')
        .update({
          status: 'processing',
          request_fingerprint: requestFingerprint,
          dispute_event_id: input.disputeEventId || null,
          claimed_at: new Date().toISOString(),
          error_message: null,
        })
        .eq('id', existing.id)
        .eq('location_id', input.locationId)
        .eq('status', 'failed')
        .eq('provider_called', false)
        .select('*')
        .maybeSingle();
      if (retryError) throw migrationError(retryError);
      if (retried) return { action: 'execute', claim: retried as DefenseSubmissionClaim };
    }

    if (existing.request_fingerprint !== requestFingerprint) {
      throw new ConflictError('The defense packet changed after a submission attempt. Review its submission status before trying again.');
    }

    return { action: 'blocked', claim: existing as DefenseSubmissionClaim };
  },

  /**
   * Persist an ambiguous state before the external call. If the process dies
   * after Stripe receives the request, a retry remains blocked instead of
   * silently submitting the same evidence twice.
   */
  async markProviderStarted(input: {
    claimId: string;
    locationId: string;
    providerReference?: string | null;
  }): Promise<void> {
    await requireUpdatedRow(
      getSupabase()
        .from('defense_submission_claims')
        .update({
          status: 'unknown',
          provider_called: true,
          provider_reference: input.providerReference || null,
          provider_started_at: new Date().toISOString(),
          error_message: 'Provider request started; awaiting confirmed result.',
        })
        .eq('id', input.claimId)
        .eq('location_id', input.locationId)
        .eq('status', 'processing')
        .select('id'),
      'Defense submission claim',
    );
  },

  async markProviderAccepted(input: {
    claimId: string;
    locationId: string;
    providerReference?: string | null;
    providerCalled: boolean;
  }): Promise<void> {
    await requireUpdatedRow(
      getSupabase()
        .from('defense_submission_claims')
        .update({
          status: 'provider_accepted',
          provider_called: input.providerCalled,
          provider_reference: input.providerReference || null,
          provider_accepted_at: new Date().toISOString(),
          error_message: null,
        })
        .eq('id', input.claimId)
        .eq('location_id', input.locationId)
        .in('status', ['processing', 'unknown'])
        .select('id'),
      'Defense submission claim',
    );
  },

  async markFailedBeforeProvider(input: { claimId: string; locationId: string; error: string }): Promise<void> {
    const { error } = await getSupabase()
      .from('defense_submission_claims')
      .update({ status: 'failed', provider_called: false, error_message: input.error })
      .eq('id', input.claimId)
      .eq('location_id', input.locationId)
      .eq('status', 'processing')
      .eq('provider_called', false);
    if (error) throw migrationError(error);
  },

  async markUnknown(input: { claimId: string; locationId: string; error: string }): Promise<void> {
    const { error } = await getSupabase()
      .from('defense_submission_claims')
      .update({ status: 'unknown', provider_called: true, error_message: input.error })
      .eq('id', input.claimId)
      .eq('location_id', input.locationId);
    if (error) throw migrationError(error);
  },

  /** Finalize only local records. This is safe to retry after provider success. */
  async finalizeAccepted(claimId: string, locationId: string): Promise<void> {
    const supabase = getSupabase();
    const { data: claim, error: claimError } = await supabase
      .from('defense_submission_claims')
      .select('*')
      .eq('id', claimId)
      .eq('location_id', locationId)
      .maybeSingle();
    if (claimError) throw migrationError(claimError);
    if (!claim) throw new NotFoundError('Defense submission claim');
    if (claim.status === 'submitted') return;
    if (claim.status !== 'provider_accepted') {
      throw new ConflictError(`Defense submission cannot be finalized from '${claim.status}'.`);
    }

    const { data: packet, error: packetError } = await supabase
      .from('defense_packets')
      .select('id, dispute_event_id, lifecycle_status')
      .eq('id', claim.defense_packet_id)
      .eq('location_id', locationId)
      .maybeSingle();
    if (packetError) throw packetError;
    if (!packet) throw new NotFoundError('Defense packet');

    const { data: latestVersion, error: versionReadError } = await supabase
      .from('defense_letter_versions')
      .select('id, version_number, is_submitted_version')
      .eq('defense_packet_id', packet.id)
      .order('version_number', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (versionReadError) throw versionReadError;
    if (!latestVersion) throw new Error('Defense packet has no letter version to lock');

    if (!latestVersion.is_submitted_version) {
      await requireUpdatedRow(
        supabase
          .from('defense_letter_versions')
          .update({ is_submitted_version: true })
          .eq('id', latestVersion.id)
          .eq('defense_packet_id', packet.id)
          .select('id'),
        'Defense letter version',
      );
    }

    if (packet.lifecycle_status !== 'submitted') {
      if (packet.lifecycle_status !== 'pending_submission') {
        throw new ConflictError(`Defense packet cannot be finalized from '${packet.lifecycle_status}'.`);
      }
      await requireUpdatedRow(
        supabase
          .from('defense_packets')
          .update({ lifecycle_status: 'submitted', submitted_at: new Date().toISOString() })
          .eq('id', packet.id)
          .eq('location_id', locationId)
          .eq('lifecycle_status', 'pending_submission')
          .select('id'),
        'Defense packet',
      );
    }

    if (packet.dispute_event_id) {
      await requireUpdatedRow(
        supabase
          .from('dispute_events')
          .update({
            status: 'under_review',
            evidence_submitted: true,
            evidence_submitted_at: new Date().toISOString(),
          })
          .eq('id', packet.dispute_event_id)
          .eq('location_id', locationId)
          .select('id'),
        'Dispute event',
      );
    }

    await requireUpdatedRow(
      supabase
        .from('defense_submission_claims')
        .update({ status: 'submitted', submitted_at: new Date().toISOString(), error_message: null })
        .eq('id', claim.id)
        .eq('location_id', locationId)
        .eq('status', 'provider_accepted')
        .select('id'),
      'Defense submission claim',
    );
  },

  async reconcileAccepted(limit = 20): Promise<number> {
    const { data, error } = await getSupabase()
      .from('defense_submission_claims')
      .select('id, location_id')
      .eq('status', 'provider_accepted')
      .order('updated_at', { ascending: true })
      .limit(limit);
    if (error) throw migrationError(error);
    let reconciled = 0;
    for (const claim of data || []) {
      try {
        await this.finalizeAccepted(claim.id, claim.location_id);
        reconciled += 1;
      } catch (err: any) {
        logger.error({ err: err.message, claimId: claim.id }, 'Defense submission local reconciliation failed');
      }
    }
    return reconciled;
  },
};
