export interface AdaptivePollerOptions {
  task: () => Promise<number>;
  initialDelayMs?: number;
  activeDelayMs?: number;
  idleBaseDelayMs?: number;
  maxIdleDelayMs?: number;
  jitterRatio?: number;
  random?: () => number;
  onError?: (error: unknown) => void;
}

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
  private readonly options: Required<Omit<AdaptivePollerOptions, 'onError'>> & Pick<AdaptivePollerOptions, 'onError'>;
  private timer: NodeJS.Timeout | null = null;
  private started = false;
  private executing = false;
  private idleRuns = 0;

  constructor(options: AdaptivePollerOptions) {
    this.options = {
      task: options.task,
      initialDelayMs: options.initialDelayMs ?? 1000,
      activeDelayMs: options.activeDelayMs ?? 5000,
      idleBaseDelayMs: options.idleBaseDelayMs ?? 15_000,
      maxIdleDelayMs: options.maxIdleDelayMs ?? 60_000,
      jitterRatio: options.jitterRatio ?? 0.15,
      random: options.random ?? Math.random,
      onError: options.onError,
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
    if (!this.started || this.executing) return;
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
    this.executing = true;

    let workCount = 0;
    try {
      workCount = Math.max(0, Number(await this.options.task()) || 0);
    } catch (error) {
      this.options.onError?.(error);
    } finally {
      this.executing = false;
    }

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
