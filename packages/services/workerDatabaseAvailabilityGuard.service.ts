import { getWorkerPostgresPool } from './workerPostgresPool';

export type WorkerDatabaseAvailabilityState =
  'healthy' | 'degraded' | 'suspended' | 'recovering' | 'stopped';

interface WorkerDatabaseProbe {
  query(config: { text: string; query_timeout: number }): Promise<unknown>;
}

interface WorkerDatabaseAvailabilityLog {
  info?: (obj: unknown, message?: string) => void;
  warn?: (obj: unknown, message?: string) => void;
  error?: (obj: unknown, message?: string) => void;
}

export interface WorkerDatabaseAvailabilityGuardOptions {
  provider: 'baileys' | 'wwebjs' | 'whatsmeow';
  onSuspend: () => Promise<void>;
  reacquireFence: () => Promise<void>;
  onResume: () => Promise<void>;
  pool?: WorkerDatabaseProbe;
  log?: WorkerDatabaseAvailabilityLog;
  outageGraceMs?: number;
  probeIntervalMs?: number;
  queryTimeoutMs?: number;
  now?: () => number;
}

export interface WorkerDatabaseAvailabilitySnapshot {
  state: WorkerDatabaseAvailabilityState;
  failureStartedAt: number | null;
  outageMs: number;
  suspensionApplied: boolean;
}

const DEFAULT_OUTAGE_GRACE_MS = 30_000;
const DEFAULT_PROBE_INTERVAL_MS = 5_000;
const DEFAULT_QUERY_TIMEOUT_MS = 5_000;

function positiveInteger(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Fail-closed availability barrier shared by WhatsApp workers.
 *
 * A successful health probe after a suspension is deliberately insufficient
 * to resume work. The runtime must first reacquire its durable writer fence;
 * only then may the provider-specific resume callback restart connections or
 * consumers.
 */
export class WorkerDatabaseAvailabilityGuard {
  private readonly pool: WorkerDatabaseProbe;
  private readonly outageGraceMs: number;
  private readonly probeIntervalMs: number;
  private readonly queryTimeoutMs: number;
  private readonly now: () => number;
  private state: WorkerDatabaseAvailabilityState = 'stopped';
  private failureStartedAt: number | null = null;
  private timer: NodeJS.Timeout | undefined;
  private probePromise: Promise<WorkerDatabaseAvailabilitySnapshot> | null =
    null;
  private suspensionPromise: {
    disruptionGeneration: number;
    promise: Promise<boolean>;
  } | null = null;
  private disruptionGeneration = 0;
  private suspensionAppliedGeneration: number | null = null;
  private lifecycleGeneration = 0;

  constructor(
    private readonly options: WorkerDatabaseAvailabilityGuardOptions
  ) {
    this.pool =
      options.pool ??
      (getWorkerPostgresPool() as unknown as WorkerDatabaseProbe);
    this.outageGraceMs = positiveInteger(
      options.outageGraceMs ?? process.env.WORKER_DATABASE_OUTAGE_GRACE_MS,
      DEFAULT_OUTAGE_GRACE_MS
    );
    this.probeIntervalMs = positiveInteger(
      options.probeIntervalMs,
      DEFAULT_PROBE_INTERVAL_MS
    );
    this.queryTimeoutMs = positiveInteger(
      options.queryTimeoutMs,
      DEFAULT_QUERY_TIMEOUT_MS
    );
    this.now = options.now ?? Date.now;
  }

  start(): void {
    if (this.state !== 'stopped') {
      return;
    }

    this.lifecycleGeneration += 1;
    this.state = 'healthy';
    const generation = this.lifecycleGeneration;
    void this.probeNow().finally(() => this.scheduleNextProbe(generation));
  }

  stop(): void {
    this.lifecycleGeneration += 1;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    this.state = 'stopped';
    this.failureStartedAt = null;
    this.suspensionPromise = null;
    this.disruptionGeneration = 0;
    this.suspensionAppliedGeneration = null;
  }

  getSnapshot(): WorkerDatabaseAvailabilitySnapshot {
    const now = this.now();
    return {
      state: this.state,
      failureStartedAt: this.failureStartedAt,
      outageMs:
        this.failureStartedAt === null
          ? 0
          : Math.max(0, now - this.failureStartedAt),
      suspensionApplied:
        this.suspensionAppliedGeneration === this.disruptionGeneration &&
        this.disruptionGeneration > 0,
    };
  }

  probeNow(): Promise<WorkerDatabaseAvailabilitySnapshot> {
    if (this.probePromise) {
      return this.probePromise;
    }

    const generation = this.lifecycleGeneration;
    const probe = this.runProbe(generation).finally(() => {
      if (this.probePromise === probe) {
        this.probePromise = null;
      }
    });
    this.probePromise = probe;
    return probe;
  }

  /**
   * A session lease loss is stronger evidence than a failed availability
   * probe. The runtime has already lost its writer fence, so it must suspend
   * immediately even when the database outage has not reached the ordinary
   * grace period. Recovery still follows the normal probe -> reacquire fence
   * -> provider resume sequence.
   */
  async reportSessionLeaseLost(): Promise<WorkerDatabaseAvailabilitySnapshot> {
    const generation = this.lifecycleGeneration;
    if (!this.isCurrentLifecycle(generation)) {
      return this.getSnapshot();
    }

    const now = this.now();
    this.failureStartedAt ??= now;
    if (this.state !== 'suspended') {
      this.disruptionGeneration += 1;
      this.suspensionAppliedGeneration = null;
    }
    this.state = 'suspended';
    await this.applySuspension(
      generation,
      Math.max(0, now - this.failureStartedAt),
      this.disruptionGeneration
    );
    return this.getSnapshot();
  }

  private async runProbe(
    generation: number
  ): Promise<WorkerDatabaseAvailabilitySnapshot> {
    if (!this.isCurrentLifecycle(generation)) {
      return this.getSnapshot();
    }

    try {
      await this.pool.query({
        text: 'SELECT 1',
        query_timeout: this.queryTimeoutMs,
      });
    } catch {
      return this.recordProbeFailure(generation);
    }

    if (!this.isCurrentLifecycle(generation)) {
      return this.getSnapshot();
    }
    if (
      this.state !== 'suspended' &&
      this.state !== 'recovering' &&
      this.suspensionAppliedGeneration === null
    ) {
      this.failureStartedAt = null;
      this.state = 'healthy';
      return this.getSnapshot();
    }

    return this.tryResume(generation);
  }

  private async recordProbeFailure(
    generation: number
  ): Promise<WorkerDatabaseAvailabilitySnapshot> {
    if (!this.isCurrentLifecycle(generation)) {
      return this.getSnapshot();
    }

    const now = this.now();
    this.failureStartedAt ??= now;
    const outageMs = Math.max(0, now - this.failureStartedAt);
    if (outageMs < this.outageGraceMs) {
      this.state = 'degraded';
      return this.getSnapshot();
    }

    if (this.state !== 'suspended') {
      this.disruptionGeneration += 1;
      this.suspensionAppliedGeneration = null;
    }
    this.state = 'suspended';
    await this.applySuspension(generation, outageMs, this.disruptionGeneration);
    return this.getSnapshot();
  }

  private async applySuspension(
    generation: number,
    outageMs: number,
    disruptionGeneration: number
  ): Promise<boolean> {
    if (
      disruptionGeneration !== this.disruptionGeneration ||
      !this.isCurrentLifecycle(generation)
    ) {
      return false;
    }
    if (this.suspensionAppliedGeneration === disruptionGeneration) {
      return true;
    }
    if (this.suspensionPromise) {
      await this.suspensionPromise.promise;
      return this.applySuspension(generation, outageMs, disruptionGeneration);
    }

    const suspension = (async (): Promise<boolean> => {
      try {
        await this.options.onSuspend();
      } catch {
        this.log('error', 'worker_database_suspension_failed', outageMs);
        return false;
      }

      if (
        !this.isCurrentLifecycle(generation) ||
        disruptionGeneration !== this.disruptionGeneration
      ) {
        return false;
      }
      this.suspensionAppliedGeneration = disruptionGeneration;
      this.log('warn', 'worker_database_runtime_suspended', outageMs);
      return true;
    })();
    const tracked = { disruptionGeneration, promise: suspension };
    this.suspensionPromise = tracked;
    try {
      return await suspension;
    } finally {
      if (this.suspensionPromise === tracked) {
        this.suspensionPromise = null;
      }
    }
  }

  private async tryResume(
    generation: number
  ): Promise<WorkerDatabaseAvailabilitySnapshot> {
    const outageMs =
      this.failureStartedAt === null
        ? 0
        : Math.max(0, this.now() - this.failureStartedAt);
    const recoveryDisruptionGeneration = this.disruptionGeneration;
    if (
      !(await this.applySuspension(
        generation,
        outageMs,
        recoveryDisruptionGeneration
      ))
    ) {
      this.state = this.isCurrentLifecycle(generation)
        ? 'suspended'
        : this.state;
      return this.getSnapshot();
    }
    if (!this.isCurrentLifecycle(generation)) {
      return this.getSnapshot();
    }

    this.state = 'recovering';
    let resumeStarted = false;
    try {
      await this.options.reacquireFence();
      if (
        !this.isCurrentLifecycle(generation) ||
        recoveryDisruptionGeneration !== this.disruptionGeneration ||
        this.state !== 'recovering'
      ) {
        if (this.isCurrentLifecycle(generation)) {
          this.state = 'suspended';
          await this.applySuspension(
            generation,
            outageMs,
            this.disruptionGeneration
          );
        }
        return this.getSnapshot();
      }
      resumeStarted = true;
      await this.options.onResume();
    } catch {
      if (this.isCurrentLifecycle(generation)) {
        this.disruptionGeneration += 1;
        this.suspensionAppliedGeneration = null;
        this.state = 'suspended';
        this.log('warn', 'worker_database_recovery_deferred', outageMs);
        await this.applySuspension(
          generation,
          outageMs,
          this.disruptionGeneration
        );
      }
      return this.getSnapshot();
    }

    if (
      !this.isCurrentLifecycle(generation) ||
      recoveryDisruptionGeneration !== this.disruptionGeneration ||
      this.state !== 'recovering'
    ) {
      if (this.isCurrentLifecycle(generation)) {
        // A lease may be lost while onResume is opening provider resources.
        // Its first suspension can finish before that stale resume does, so a
        // final post-resume suspension is required to close anything opened
        // after the newer fence was already lost.
        if (resumeStarted) {
          this.disruptionGeneration += 1;
          this.suspensionAppliedGeneration = null;
        }
        this.state = 'suspended';
        await this.applySuspension(
          generation,
          outageMs,
          this.disruptionGeneration
        );
      }
      return this.getSnapshot();
    }
    this.state = 'healthy';
    this.failureStartedAt = null;
    this.suspensionAppliedGeneration = null;
    this.log('info', 'worker_database_runtime_resumed', outageMs);
    return this.getSnapshot();
  }

  private scheduleNextProbe(generation: number): void {
    if (!this.isCurrentLifecycle(generation) || this.timer) {
      return;
    }
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.probeNow().finally(() => this.scheduleNextProbe(generation));
    }, this.probeIntervalMs);
    this.timer.unref?.();
  }

  private isCurrentLifecycle(generation: number): boolean {
    return this.state !== 'stopped' && generation === this.lifecycleGeneration;
  }

  private log(
    level: 'info' | 'warn' | 'error',
    event: string,
    outageMs: number
  ): void {
    this.options.log?.[level]?.(
      {
        component: 'worker_database_availability',
        provider: this.options.provider,
        event,
        outage_ms: Math.max(0, Math.floor(outageMs)),
      },
      event
    );
  }
}
