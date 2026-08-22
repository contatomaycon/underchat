export interface FairKeyedSchedulerOptions {
  maxActiveLanes?: number;
  maxQueuedTasks?: number;
}

type QueuedTask<T> = {
  run: () => Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
};

/**
 * One task per key at a time, while distinct keys make bounded progress in a
 * round-robin. A slow chat therefore cannot occupy another chat's logical
 * lane. The provider retains its own independent socket semaphore.
 */
export class FairKeyedScheduler {
  private readonly maxActiveLanes: number;
  private readonly maxQueuedTasks: number;
  private readonly queues = new Map<string, QueuedTask<unknown>[]>();
  private readonly ready: string[] = [];
  private readonly readySet = new Set<string>();
  private readonly active = new Set<string>();
  private queuedTasks = 0;
  private closing = false;
  private drainWaiters: Array<() => void> = [];

  constructor(options: FairKeyedSchedulerOptions = {}) {
    this.maxActiveLanes = this.bounded(options.maxActiveLanes, 32, 1, 256);
    this.maxQueuedTasks = this.bounded(
      options.maxQueuedTasks,
      10_000,
      this.maxActiveLanes,
      100_000
    );
  }

  public enqueue<T>(key: string, run: () => Promise<T>): Promise<T> {
    const normalizedKey = key.trim();
    if (!normalizedKey) {
      return Promise.reject(new Error('fair_scheduler_key_invalid'));
    }
    if (this.closing) {
      return Promise.reject(new Error('fair_scheduler_closed'));
    }
    if (this.queuedTasks >= this.maxQueuedTasks) {
      return Promise.reject(new FairSchedulerSaturatedError());
    }

    return new Promise<T>((resolve, reject) => {
      const queue = this.queues.get(normalizedKey) ?? [];
      queue.push({ run, resolve, reject } as QueuedTask<unknown>);
      this.queues.set(normalizedKey, queue);
      this.queuedTasks += 1;
      this.makeReady(normalizedKey);
      this.pump();
    });
  }

  public async closeAndDrain(): Promise<void> {
    this.closing = true;
    if (this.queuedTasks === 0 && this.active.size === 0) return;
    await new Promise<void>((resolve) => this.drainWaiters.push(resolve));
  }

  public snapshot(): {
    activeLanes: number;
    readyLanes: number;
    queuedTasks: number;
  } {
    return {
      activeLanes: this.active.size,
      readyLanes: this.ready.length,
      queuedTasks: this.queuedTasks,
    };
  }

  private makeReady(key: string): void {
    if (this.active.has(key) || this.readySet.has(key)) return;
    this.ready.push(key);
    this.readySet.add(key);
  }

  private pump(): void {
    while (this.active.size < this.maxActiveLanes && this.ready.length > 0) {
      const key = this.ready.shift();
      if (!key) continue;
      this.readySet.delete(key);
      const queue = this.queues.get(key);
      const task = queue?.shift();
      if (!task) {
        this.queues.delete(key);
        continue;
      }
      this.active.add(key);
      void task
        .run()
        .then(task.resolve, task.reject)
        .finally(() => {
          this.queuedTasks -= 1;
          this.active.delete(key);
          const remaining = this.queues.get(key);
          if (remaining && remaining.length > 0) {
            this.makeReady(key);
          } else {
            this.queues.delete(key);
          }
          this.pump();
          this.resolveDrainIfIdle();
        });
    }
  }

  private resolveDrainIfIdle(): void {
    if (this.queuedTasks !== 0 || this.active.size !== 0) return;
    const waiters = this.drainWaiters;
    this.drainWaiters = [];
    waiters.forEach((resolve) => resolve());
  }

  private bounded(
    value: number | undefined,
    fallback: number,
    min: number,
    max: number
  ): number {
    return typeof value === 'number' && Number.isFinite(value)
      ? Math.min(max, Math.max(min, Math.floor(value)))
      : fallback;
  }
}

export class FairSchedulerSaturatedError extends Error {
  public readonly retryable = true;

  constructor() {
    super('fair_scheduler_saturated');
    this.name = 'FairSchedulerSaturatedError';
  }
}
