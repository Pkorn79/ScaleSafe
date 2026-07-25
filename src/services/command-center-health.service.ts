import { config } from '../config';
import { commandCenterHealthRepository } from '../repositories/command-center-health.repository';
import { WorkerHeartbeatState } from '../types/command-center-health.types';
import { logger } from '../utils/logger';

const WORKER_TIMEOUT_MS: Readonly<Record<string, number>> = {
  'worker.trigger_delivery': 120_000,
  'worker.external_evidence': 75_000,
  'worker.money_reconciliation': 90_000,
  'worker.defense_compilation': 270_000,
};

const WORKER_HEARTBEAT_INTERVAL_MS: Readonly<Record<keyof typeof WORKER_TIMEOUT_MS, number>> = {
  'worker.trigger_delivery': 5 * 60_000,
  'worker.external_evidence': 5 * 60_000,
  'worker.money_reconciliation': 60_000,
  'worker.defense_compilation': 5 * 60_000,
};

const UNSAFE_PRODUCTION_FLAGS = [
  'ALLOW_DEV_LOCATION_AUTH',
  'ALLOW_UNSIGNED_GHL_WEBHOOKS',
  'ALLOW_UNSIGNED_STRIPE_STATE',
  'ALLOW_LEGACY_PUBLIC_ACTION_LINKS',
  'VITE_ENABLE_DAILY_TEST_BILLING',
] as const;

const healthWriteWarningAt = new Map<string, number>();
const workerHeartbeatAttempt = new Map<string, {
  state: WorkerHeartbeatState;
  errorClass: string;
  attemptedAt: number;
}>();

export function classifyCommandCenterError(error: unknown): {
  errorClass: string;
  safeMessage: string;
} {
  const err = error as any;
  const name = String(err?.name || '');
  const code = String(err?.code || '');
  const message = String(err?.message || '');

  if (name === 'SupabaseRequestTimeoutError' || /request exceeded \d+ms/i.test(message)) {
    return { errorClass: 'SUPABASE_TIMEOUT', safeMessage: 'The database request timed out.' };
  }
  if (code === '42883' || /requires migration 104|record_service_heartbeat/i.test(message)) {
    return { errorClass: 'HEALTH_SCHEMA_NOT_READY', safeMessage: 'Command Center health schema is unavailable.' };
  }
  if (/fetch|network|socket|connection/i.test(`${name} ${message}`)) {
    return { errorClass: 'DEPENDENCY_NETWORK_ERROR', safeMessage: 'A dependency request failed.' };
  }
  return { errorClass: 'WORKER_TICK_FAILED', safeMessage: 'The worker tick failed.' };
}

function warnHealthWriteFailure(key: string, error: unknown): void {
  const now = Date.now();
  const last = healthWriteWarningAt.get(key) || 0;
  if (now - last < 5 * 60_000) return;
  healthWriteWarningAt.set(key, now);
  const classified = classifyCommandCenterError(error);
  logger.warn(
    { checkKey: key, errorClass: classified.errorClass },
    'Command Center health write failed without affecting business processing',
  );
}

export const commandCenterHealthService = {
  enabled(): boolean {
    return Boolean((config as any).operator?.healthEnabled);
  },

  productionSafetyPosture(): {
    runtimeEnvironment: string;
    dangerousFlags: string[];
  } {
    return {
      runtimeEnvironment: config.nodeEnv,
      dangerousFlags: UNSAFE_PRODUCTION_FLAGS.filter(
        (key) => process.env[key] === 'true',
      ),
    };
  },

  recordWorkerTick(input: {
    workerKey: keyof typeof WORKER_TIMEOUT_MS;
    instanceId: string;
    startedAt: Date;
    completedAt?: Date;
    workCount: number;
    error?: unknown;
    timedOut?: boolean;
  }): void {
    if (!this.enabled()) return;

    const completedAt = input.completedAt || new Date();
    const durationMs = Math.max(0, completedAt.getTime() - input.startedAt.getTime());
    const classified = input.timedOut
      ? {
        errorClass: 'WORKER_TICK_TIMEOUT',
        safeMessage: 'The worker tick exceeded its approved execution window.',
      }
      : input.error
        ? classifyCommandCenterError(input.error)
        : null;
    const state: WorkerHeartbeatState = input.timedOut
      ? 'timed_out'
      : input.error
        ? 'failed'
        : durationMs > WORKER_TIMEOUT_MS[input.workerKey]
        ? 'timed_out'
        : 'healthy';
    const heartbeatKey = `${input.workerKey}:${input.instanceId}`;
    const previous = workerHeartbeatAttempt.get(heartbeatKey);
    if (
      previous
      && previous.state === state
      && previous.errorClass === (classified?.errorClass || '')
      && completedAt.getTime() - previous.attemptedAt
        < WORKER_HEARTBEAT_INTERVAL_MS[input.workerKey]
    ) {
      return;
    }
    workerHeartbeatAttempt.set(heartbeatKey, {
      state,
      errorClass: classified?.errorClass || '',
      attemptedAt: completedAt.getTime(),
    });

    void commandCenterHealthRepository.recordWorkerHeartbeat({
      workerKey: input.workerKey,
      instanceId: input.instanceId,
      state,
      startedAt: input.startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      durationMs,
      workCount: Math.max(0, Math.floor(input.workCount || 0)),
      errorClass: classified?.errorClass,
      errorMessage: classified?.safeMessage,
    }).catch((error) => warnHealthWriteFailure(input.workerKey, error));
  },

  workerTimeoutMs(workerKey: keyof typeof WORKER_TIMEOUT_MS): number {
    return WORKER_TIMEOUT_MS[workerKey];
  },

  recordObservationSafely(input: Parameters<typeof commandCenterHealthRepository.recordObservation>[0]): void {
    if (!this.enabled()) return;
    void commandCenterHealthRepository.recordObservation(input)
      .catch((error) => warnHealthWriteFailure(input.checkKey, error));
  },

  markMerchantDirty(locationId: string, reason: string): void {
    if (!this.enabled() || !locationId) return;
    void commandCenterHealthRepository.markMerchantHealthDirty(locationId, reason)
      .catch((error) => warnHealthWriteFailure(`merchant:${reason}`, error));
  },
};
