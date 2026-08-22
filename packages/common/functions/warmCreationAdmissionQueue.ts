export class WarmCreationAdmissionQueueClosedError extends Error {
  constructor() {
    super('warm_creation_admission_queue_closed');
    this.name = 'WarmCreationAdmissionQueueClosedError';
  }
}

export class WarmCreationAdmissionQueueSaturatedError extends Error {
  constructor(readonly maxPending: number) {
    super(`warm_creation_admission_queue_saturated:${maxPending}`);
    this.name = 'WarmCreationAdmissionQueueSaturatedError';
  }
}

export class WarmCreationAdmissionQueueOperationTimeoutError extends Error {
  constructor(
    readonly key: string,
    readonly timeoutMs: number
  ) {
    super(`warm_creation_operation_timeout:${key}:${timeoutMs}`);
    this.name = 'WarmCreationAdmissionQueueOperationTimeoutError';
  }
}

export interface IWarmCreationAdmissionQueueDrainResult {
  completed: boolean;
  pending: number;
}

export interface IWarmCreationAdmissionQueueOptions {
  maxPending?: number;
  operationTimeoutMs?: number;
  onOperationTimeout?: (
    error: WarmCreationAdmissionQueueOperationTimeoutError
  ) => void;
}

/**
 * Keeps warm creation admission fast while preserving the original
 * server/provider ordering. A Balance owns exactly one server, so serializing
 * each provider also bounds Docker pressure to at most three active creates.
 */
export class WarmCreationAdmissionQueue {
  private readonly tails = new Map<string, Promise<void>>();
  private readonly pending = new Set<Promise<void>>();
  private readonly activeOperations = new Set<Promise<void>>();
  private readonly maxPending: number;
  private readonly operationTimeoutMs: number;
  private readonly onOperationTimeout:
    | ((error: WarmCreationAdmissionQueueOperationTimeoutError) => void)
    | undefined;
  private accepting = true;
  private stalledError: WarmCreationAdmissionQueueOperationTimeoutError | null =
    null;
  private closePromise: Promise<IWarmCreationAdmissionQueueDrainResult> | null =
    null;

  constructor(options: IWarmCreationAdmissionQueueOptions = {}) {
    this.maxPending = Math.max(1, Math.floor(options.maxPending ?? 36));
    this.operationTimeoutMs = Math.max(
      1,
      Math.floor(options.operationTimeoutMs ?? 7 * 60_000)
    );
    this.onOperationTimeout = options.onOperationTimeout;
  }

  enqueue(key: string, operation: () => Promise<void>): Promise<void> {
    if (!this.accepting) {
      throw new WarmCreationAdmissionQueueClosedError();
    }
    if (this.pending.size >= this.maxPending) {
      throw new WarmCreationAdmissionQueueSaturatedError(this.maxPending);
    }

    const previous = this.tails.get(key) ?? Promise.resolve();
    const admitted = previous
      .catch(() => undefined)
      .then(() => {
        if (this.stalledError) {
          throw this.stalledError;
        }
        return this.runWithDeadline(key, operation);
      });
    let observed: Promise<void>;
    observed = admitted
      .then(
        () => undefined,
        () => undefined
      )
      .finally(() => {
        this.pending.delete(observed);
        if (this.tails.get(key) === observed) {
          this.tails.delete(key);
        }
      });

    /*
     * `observed` installs a rejection handler synchronously, before the gRPC
     * callback can throw or the client can cancel. The caller still receives
     * `admitted` so it can log the operation-specific failure.
     */
    this.tails.set(key, observed);
    this.pending.add(observed);
    return admitted;
  }

  private async runWithDeadline(
    key: string,
    operation: () => Promise<void>
  ): Promise<void> {
    const running = Promise.resolve().then(operation);
    let observedRunning: Promise<void>;
    observedRunning = running
      .then(
        () => undefined,
        () => undefined
      )
      .finally(() => {
        this.activeOperations.delete(observedRunning);
      });
    this.activeOperations.add(observedRunning);

    let timeout: ReturnType<typeof setTimeout> | null = null;
    const deadline = new Promise<never>((_, reject) => {
      timeout = setTimeout(() => {
        const error = new WarmCreationAdmissionQueueOperationTimeoutError(
          key,
          this.operationTimeoutMs
        );
        if (!this.stalledError) {
          this.stalledError = error;
          this.accepting = false;
          try {
            this.onOperationTimeout?.(error);
          } catch {}
        }
        reject(this.stalledError);
      }, this.operationTimeoutMs);
      timeout.unref?.();
    });

    try {
      await Promise.race([running, deadline]);
    } finally {
      if (timeout) {
        clearTimeout(timeout);
      }
    }
  }

  close(timeoutMs: number): Promise<IWarmCreationAdmissionQueueDrainResult> {
    if (this.closePromise) {
      return this.closePromise;
    }

    this.accepting = false;
    const pendingAtClose = Math.max(
      this.pending.size,
      this.activeOperations.size
    );
    if (pendingAtClose === 0) {
      return Promise.resolve({ completed: true, pending: 0 });
    }

    const drain = Promise.allSettled([
      ...this.pending,
      ...this.activeOperations,
    ]).then((): IWarmCreationAdmissionQueueDrainResult => ({
      completed: true,
      pending: 0,
    }));
    const boundedTimeoutMs = Math.max(1, Math.floor(timeoutMs));
    let timeout: ReturnType<typeof setTimeout> | null = null;
    const deadline = new Promise<IWarmCreationAdmissionQueueDrainResult>(
      (resolve) => {
        timeout = setTimeout(
          () =>
            resolve({
              completed: false,
              pending: Math.max(this.pending.size, this.activeOperations.size),
            }),
          boundedTimeoutMs
        );
        timeout.unref?.();
      }
    );

    const closePromise = Promise.race([drain, deadline]).finally(() => {
      if (timeout) {
        clearTimeout(timeout);
      }
    });
    this.closePromise = closePromise;
    return closePromise;
  }
}
