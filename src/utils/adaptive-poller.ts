export interface AdaptivePollerOptions {
  task: () => Promise<number>;
  initialDelayMs?: number;
  activeDelayMs?: number;
  idleBaseDelayMs?: number;
  maxIdleDelayMs?: number;
  taskTimeoutMs?: number;
  settlementProbeMs?: number;
  jitterRatio?: number;
  random?: () => number;
  onError?: (error: unknown) => void;
  onTimeout?: (context: {
    startedAt: Date;
    timedOutAt: Date;
    timeoutMs: number;
  }) => void;
}

type AdaptiveTaskOutcome =
  | { kind: 'completed'; workCount: number }
  | { kind: 'failed'; error: unknown };

export function nextIdleDelayMs(
  idleRuns: number,
  baseDelayMs: number,
  maxDelayMs: number,
): number {
  const exponent = Math.max(0, idleRuns - 1);
  return Math.min(maxDelayMs, baseDelayMs * Math.pow(2, exponent));
}

export function jitterDelayMs(delayMs: number, ratio: number, randomValue: number): number {
  const boundedRatio = Math.max(0, Math.min(1, ratio));
  const boundedRandom = Math.max(0, Math.min(1, randomValue));
  const multiplier = 1 + ((boundedRandom * 2) - 1) * boundedRatio;
  return Math.max(0, Math.round(delayMs * multiplier));
}

/**
 * Runs durable queue workers quickly while work exists, then progressively
 * reduces empty polling without allowing overlapping executions.
 */
export class AdaptivePoller {
  private readonly options: Required<Omit<AdaptivePollerOptions, 'onError' | 'onTimeout'>>
    & Pick<AdaptivePollerOptions, 'onError' | 'onTimeout'>;
  private timer: NodeJS.Timeout | null = null;
  private started = false;
  private executing = false;
  private idleRuns = 0;
  private quarantinedTask: Promise<AdaptiveTaskOutcome> | null = null;

  constructor(options: AdaptivePollerOptions) {
    this.options = {
      task: options.task,
      initialDelayMs: options.initialDelayMs ?? 1000,
      activeDelayMs: options.activeDelayMs ?? 5000,
      idleBaseDelayMs: options.idleBaseDelayMs ?? 15_000,
      maxIdleDelayMs: options.maxIdleDelayMs ?? 60_000,
      taskTimeoutMs: options.taskTimeoutMs ?? 0,
      settlementProbeMs: options.settlementProbeMs ?? 15_000,
      jitterRatio: options.jitterRatio ?? 0.15,
      random: options.random ?? Math.random,
      onError: options.onError,
      onTimeout: options.onTimeout,
    };
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.schedule(this.options.initialDelayMs, false);
  }

  stop(): void {
    this.started = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  wake(): void {
    if (!this.started || this.executing || this.quarantinedTask) return;
    this.idleRuns = 0;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.schedule(0, false);
  }

  private schedule(delayMs: number, jitter: boolean): void {
    if (!this.started) return;
    const actualDelay = jitter
      ? jitterDelayMs(delayMs, this.options.jitterRatio, this.options.random())
      : delayMs;
    this.timer = setTimeout(() => void this.execute(), actualDelay);
    this.timer.unref();
  }

  private async execute(): Promise<void> {
    if (!this.started || this.executing) return;
    this.timer = null;

    if (this.quarantinedTask) {
      this.schedule(this.options.settlementProbeMs, false);
      return;
    }

    this.executing = true;

    const startedAt = new Date();
    const taskOutcome = Promise.resolve()
      .then(() => this.options.task())
      .then((workCount): AdaptiveTaskOutcome => ({
        kind: 'completed',
        workCount: Math.max(0, Number(workCount) || 0),
      }))
      .catch((error): AdaptiveTaskOutcome => ({ kind: 'failed', error }));

    let outcome: AdaptiveTaskOutcome | { kind: 'timed_out' };
    if (this.options.taskTimeoutMs > 0) {
      let timeout: NodeJS.Timeout | null = null;
      const timeoutOutcome = new Promise<{ kind: 'timed_out' }>((resolve) => {
        timeout = setTimeout(
          () => resolve({ kind: 'timed_out' }),
          this.options.taskTimeoutMs,
        );
      });
      outcome = await Promise.race([taskOutcome, timeoutOutcome]);
      if (timeout) clearTimeout(timeout);
    } else {
      outcome = await taskOutcome;
    }

    if (outcome.kind === 'timed_out') {
      this.quarantinedTask = taskOutcome;
      this.executing = false;
      const timedOutAt = new Date();
      this.options.onTimeout?.({
        startedAt,
        timedOutAt,
        timeoutMs: this.options.taskTimeoutMs,
      });

      void taskOutcome.then((lateOutcome) => {
        if (this.quarantinedTask !== taskOutcome) return;
        this.quarantinedTask = null;
        if (lateOutcome.kind === 'failed') {
          this.options.onError?.(lateOutcome.error);
        }
        if (!this.started) return;
        if (this.timer) clearTimeout(this.timer);
        this.timer = null;
        this.idleRuns = lateOutcome.kind === 'completed' && lateOutcome.workCount > 0
          ? 0
          : this.idleRuns + 1;
        this.schedule(
          lateOutcome.kind === 'completed' && lateOutcome.workCount > 0
            ? this.options.activeDelayMs
            : nextIdleDelayMs(
              this.idleRuns,
              this.options.idleBaseDelayMs,
              this.options.maxIdleDelayMs,
            ),
          lateOutcome.kind !== 'completed' || lateOutcome.workCount === 0,
        );
      });

      if (this.started) this.schedule(this.options.settlementProbeMs, false);
      return;
    }

    this.executing = false;
    const workCount = outcome.kind === 'completed' ? outcome.workCount : 0;
    if (outcome.kind === 'failed') this.options.onError?.(outcome.error);

    if (!this.started) return;
    if (workCount > 0) {
      this.idleRuns = 0;
      this.schedule(this.options.activeDelayMs, false);
      return;
    }

    this.idleRuns += 1;
    this.schedule(
      nextIdleDelayMs(this.idleRuns, this.options.idleBaseDelayMs, this.options.maxIdleDelayMs),
      true,
    );
  }
}
