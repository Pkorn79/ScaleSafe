import crypto from 'crypto';
import { getSupabase } from '../clients/supabase.client';
import { logger } from '../utils/logger';
import type { DefenseCompilationJobInput } from './defense.service';
import { defenseSubmissionService } from './defense-submission.service';
import { AdaptivePoller } from '../utils/adaptive-poller';

const workerId = `defense_${process.pid}_${crypto.randomBytes(6).toString('hex')}`;
let running = false;

interface ClaimedDefensePacket {
  id: string;
  location_id: string;
  compilation_input: DefenseCompilationJobInput;
  compilation_category: string | null;
  compilation_attempts: number;
}

async function claimPackets(limit = 3): Promise<ClaimedDefensePacket[]> {
  const { data, error } = await getSupabase().rpc('claim_defense_compilations', {
    p_limit: limit,
    p_worker_id: workerId,
    p_lease_seconds: 300,
  });
  if (error) {
    if (error.code === '42883' || String(error.message || '').includes('claim_defense_compilations')) {
      throw new Error('Defense compilation worker requires migration 098.');
    }
    throw error;
  }
  return (data || []) as ClaimedDefensePacket[];
}

async function finishPacket(packet: ClaimedDefensePacket): Promise<void> {
  const { error } = await getSupabase()
    .from('defense_packets')
    .update({
      compilation_completed_at: new Date().toISOString(),
      compilation_lease_owner: null,
      compilation_lease_expires_at: null,
      compilation_next_attempt_at: null,
      compilation_last_error: null,
    })
    .eq('id', packet.id)
    .eq('location_id', packet.location_id)
    .eq('compilation_lease_owner', workerId);
  if (error) throw error;
}

async function failPacket(packet: ClaimedDefensePacket, error: Error): Promise<void> {
  const finalAttempt = Number(packet.compilation_attempts || 0) >= 3;
  const retryDelaySeconds = Math.min(300, 15 * Math.pow(2, Math.max(0, Number(packet.compilation_attempts || 1) - 1)));
  const updates = finalAttempt
    ? {
      status: 'failed',
      error_message: `Defense compilation failed after ${packet.compilation_attempts} attempts: ${error.message}`,
      compilation_last_error: error.message,
      compilation_lease_owner: null,
      compilation_lease_expires_at: null,
      compilation_next_attempt_at: null,
    }
    : {
      status: 'pending',
      error_message: `Defense compilation will retry: ${error.message}`,
      compilation_last_error: error.message,
      compilation_lease_owner: null,
      compilation_lease_expires_at: null,
      compilation_next_attempt_at: new Date(Date.now() + retryDelaySeconds * 1000).toISOString(),
    };
  const { error: updateError } = await getSupabase()
    .from('defense_packets')
    .update(updates)
    .eq('id', packet.id)
    .eq('location_id', packet.location_id)
    .eq('compilation_lease_owner', workerId);
  if (updateError) throw updateError;
}

async function processPacket(packet: ClaimedDefensePacket): Promise<void> {
  try {
    if (!packet.compilation_input || typeof packet.compilation_input !== 'object') {
      throw new Error('Defense compilation input is missing or invalid');
    }
    // Dynamic import avoids a module cycle: compileDefense writes the durable
    // queue row, while this worker invokes the same tested compilation pipeline.
    const { defenseService } = require('./defense.service');
    if ('operation' in packet.compilation_input && packet.compilation_input.operation === 'regenerate') {
      await defenseService.regenerateLetter(
        packet.id,
        packet.location_id,
        packet.compilation_input.targetVersion,
      );
    } else {
      await defenseService.runCompilation(
        packet.id,
        packet.compilation_input,
        packet.compilation_category || 'general',
      );
    }
    await finishPacket(packet);
  } catch (err: any) {
    logger.error({ err: err.message, defenseId: packet.id, attempt: packet.compilation_attempts }, 'Defense compilation worker failed');
    await failPacket(packet, err instanceof Error ? err : new Error(String(err)));
  }
}

async function tick(): Promise<number> {
  if (running) return 0;
  running = true;
  try {
    const packets = await claimPackets(3);
    await Promise.all(packets.map(processPacket));
    const reconciled = await defenseSubmissionService.reconcileAccepted(20);
    return packets.length + reconciled;
  } catch (err: any) {
    logger.error({ err: err.message }, 'Defense operations worker tick failed');
    return 0;
  } finally {
    running = false;
  }
}

const poller = new AdaptivePoller({ task: tick });

export const defenseCompilationWorker = {
  start(): void {
    poller.start();
  },
  async runOnce(): Promise<void> {
    await tick();
  },
  wake(): void {
    poller.wake();
  },
  stop(): void {
    poller.stop();
  },
};
