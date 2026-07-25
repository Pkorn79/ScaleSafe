export type HealthState = 'healthy' | 'degraded' | 'unhealthy' | 'unknown' | 'not_applicable';
export type HealthSeverity = 'critical' | 'urgent' | 'warning' | 'info';
export type WorkerHeartbeatState = 'healthy' | 'failed' | 'timed_out' | 'unknown';

export interface WorkerHeartbeatInput {
  workerKey: string;
  instanceId: string;
  state: WorkerHeartbeatState;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  workCount: number;
  errorClass?: string;
  errorMessage?: string;
}

export interface HealthObservationInput {
  scopeType: 'platform' | 'worker' | 'job' | 'queue' | 'merchant' | 'provider';
  scopeId: string;
  locationId?: string | null;
  merchantId?: string | null;
  checkKey: string;
  state: HealthState;
  severity?: HealthSeverity | null;
  failureClass?: string | null;
  summary: string;
  metrics?: Record<string, unknown>;
  observedAt?: string;
}
