import crypto from 'crypto';
import { setSupabaseRequestObserver } from '../clients/supabase.client';
import { config } from '../config';
import {
  commandCenterHealthRepository,
  setCommandCenterRequestObserver,
} from '../repositories/command-center-health.repository';
import { logger } from '../utils/logger';
import { setProviderRequestObserver } from './provider-request-observer';

const BUCKET_MS = 5 * 60_000;
const LATENCY_BOUNDS_MS = [25, 50, 100, 250, 500, 1000, 1500, 3000, 5000, 10_000, 30_000];
const EXPECTED_CLIENT_ERRORS = new Set([400, 401, 403, 404, 409, 422, 429]);
const instanceId = `http_${process.pid}_${crypto.randomBytes(6).toString('hex')}`;

interface MetricBucket {
  startedAt: Date;
  endedAt: Date;
  requestCount: number;
  clientErrorCount: number;
  serverErrorCount: number;
  supabaseRequestCount: number;
  commandCenterSupabaseRequestCount: number;
  providerRequestCount: number;
  databaseTimeoutCount: number;
  databaseCanaryLatencyMs: number | null;
  databaseCanaryFailed: boolean;
  latencyCounts: number[];
  latencyMaxMs: number;
  routeGroups: Map<string, { requests: number; serverErrors: number }>;
}

function bucketStart(now: Date): Date {
  return new Date(Math.floor(now.getTime() / BUCKET_MS) * BUCKET_MS);
}

function newBucket(now = new Date()): MetricBucket {
  const startedAt = bucketStart(now);
  return {
    startedAt,
    endedAt: new Date(startedAt.getTime() + BUCKET_MS),
    requestCount: 0,
    clientErrorCount: 0,
    serverErrorCount: 0,
    supabaseRequestCount: 0,
    commandCenterSupabaseRequestCount: 0,
    providerRequestCount: 0,
    databaseTimeoutCount: 0,
    databaseCanaryLatencyMs: null,
    databaseCanaryFailed: false,
    latencyCounts: LATENCY_BOUNDS_MS.map(() => 0),
    latencyMaxMs: 0,
    routeGroups: new Map(),
  };
}

export function normalizeMetricRouteGroup(pathValue: string): string {
  const path = String(pathValue || '/').split('?')[0];
  const segments = path.split('/').filter(Boolean).slice(0, 3).map((segment) => {
    let decoded = segment;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      return ':id';
    }
    if (decoded.includes('@')) return ':id';
    if (/^\d{4,}$/.test(decoded)) return ':id';
    if (/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(decoded)) return ':id';
    if (/^[0-9a-f]{16,}$/i.test(decoded)) return ':id';
    if (decoded.length > 32 || /^[A-Za-z0-9_-]{20,}$/.test(decoded)) return ':id';
    return decoded.toLowerCase().replace(/[^a-z0-9_.-]/g, '_');
  });
  return `/${segments.join('/')}` || '/';
}

function percentile(counts: number[], total: number, percentileValue: number): number | null {
  if (total <= 0) return null;
  const target = Math.max(1, Math.ceil(total * percentileValue));
  let seen = 0;
  for (let index = 0; index < counts.length; index += 1) {
    seen += counts[index];
    if (seen >= target) return LATENCY_BOUNDS_MS[index];
  }
  return LATENCY_BOUNDS_MS[LATENCY_BOUNDS_MS.length - 1];
}

function serialize(bucket: MetricBucket) {
  return {
    instanceId,
    bucketStartedAt: bucket.startedAt.toISOString(),
    bucketEndedAt: bucket.endedAt.toISOString(),
    requestCount: bucket.requestCount,
    clientErrorCount: bucket.clientErrorCount,
    serverErrorCount: bucket.serverErrorCount,
    supabaseRequestCount: bucket.supabaseRequestCount,
    commandCenterSupabaseRequestCount: bucket.commandCenterSupabaseRequestCount,
    providerRequestCount: bucket.providerRequestCount,
    databaseTimeoutCount: bucket.databaseTimeoutCount,
    databaseCanaryLatencyMs: bucket.databaseCanaryLatencyMs,
    databaseCanaryFailed: bucket.databaseCanaryFailed,
    latencyP50Ms: percentile(bucket.latencyCounts, bucket.requestCount, 0.5),
    latencyP95Ms: percentile(bucket.latencyCounts, bucket.requestCount, 0.95),
    latencyMaxMs: bucket.requestCount > 0 ? bucket.latencyMaxMs : null,
    routeGroups: Object.fromEntries(bucket.routeGroups),
  };
}

let current = newBucket();
let timer: NodeJS.Timeout | null = null;
let flushing = false;
const pending: ReturnType<typeof serialize>[] = [];

function queueCompletedBucket(now: Date): void {
  if (now.getTime() < current.endedAt.getTime()) return;
  const completed = current;
  current = newBucket(now);
  pending.push(serialize(completed));
  if (pending.length > 12) pending.shift();
}

async function drainPending(): Promise<void> {
  if (flushing || !config.operator.healthEnabled || pending.length === 0) return;
  flushing = true;

  try {
    while (pending.length > 0) {
      await commandCenterHealthRepository.writeApplicationMetricBucket(pending[0]);
      pending.shift();
    }
  } catch (error) {
    logger.warn(
      { component: 'application_metrics' },
      'Command Center metric flush failed without affecting requests',
    );
  } finally {
    flushing = false;
  }
}

function scheduleAlignedFlush(): void {
  if (!config.operator.healthEnabled || timer) return;
  const delayMs = Math.max(1, current.endedAt.getTime() - Date.now());
  timer = setTimeout(() => {
    timer = null;
    queueCompletedBucket(new Date());
    void drainPending();
    scheduleAlignedFlush();
  }, delayMs);
  timer.unref();
}

export const applicationMetricsService = {
  start(): void {
    if (!config.operator.healthEnabled || timer) return;
    scheduleAlignedFlush();
  },

  stop(): void {
    if (timer) clearInterval(timer);
    timer = null;
  },

  recordRequest(pathValue: string, statusCode: number, durationMs: number): void {
    if (!config.operator.healthEnabled) return;
    const now = new Date();
    queueCompletedBucket(now);
    void drainPending();

    const boundedDuration = Math.max(0, Math.min(30_000, Math.round(durationMs || 0)));
    current.requestCount += 1;
    if (EXPECTED_CLIENT_ERRORS.has(statusCode)) current.clientErrorCount += 1;
    if (statusCode >= 500) current.serverErrorCount += 1;
    current.latencyMaxMs = Math.max(current.latencyMaxMs, boundedDuration);
    const latencyIndex = LATENCY_BOUNDS_MS.findIndex((bound) => boundedDuration <= bound);
    current.latencyCounts[latencyIndex >= 0 ? latencyIndex : LATENCY_BOUNDS_MS.length - 1] += 1;

    const normalizedRouteGroup = normalizeMetricRouteGroup(pathValue);
    const key = current.routeGroups.has(normalizedRouteGroup) || current.routeGroups.size < 30
      ? normalizedRouteGroup
      : '/other';
    const group = current.routeGroups.get(key) || { requests: 0, serverErrors: 0 };
    group.requests += 1;
    if (statusCode >= 500) group.serverErrors += 1;
    current.routeGroups.set(key, group);
  },

  recordDatabaseTimeout(): void {
    if (!config.operator.healthEnabled) return;
    current.databaseTimeoutCount += 1;
  },

  recordSupabaseRequest(): void {
    if (!config.operator.healthEnabled) return;
    current.supabaseRequestCount += 1;
  },

  recordCommandCenterSupabaseRequest(): void {
    if (!config.operator.healthEnabled) return;
    current.commandCenterSupabaseRequestCount += 1;
  },

  recordProviderRequest(): void {
    if (!config.operator.healthEnabled) return;
    current.providerRequestCount += 1;
  },

  recordDatabaseCanary(durationMs: number, failed: boolean): void {
    if (!config.operator.healthEnabled) return;
    current.databaseCanaryLatencyMs = Math.max(0, Math.min(30_000, Math.round(durationMs || 0)));
    current.databaseCanaryFailed = failed;
  },

  async flushNow(): Promise<void> {
    queueCompletedBucket(new Date());
    await drainPending();
  },

  __resetForTests(now = new Date()): void {
    if (timer) clearTimeout(timer);
    timer = null;
    current = newBucket(now);
    pending.splice(0, pending.length);
    flushing = false;
  },
};

setSupabaseRequestObserver((event) => {
  applicationMetricsService.recordSupabaseRequest();
  if (event.timedOut) applicationMetricsService.recordDatabaseTimeout();
});
setCommandCenterRequestObserver(
  () => applicationMetricsService.recordCommandCenterSupabaseRequest(),
);
setProviderRequestObserver(() => applicationMetricsService.recordProviderRequest());
