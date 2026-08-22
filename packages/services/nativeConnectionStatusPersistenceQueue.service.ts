const RETRY_DELAYS_MS = [250, 1_000, 5_000] as const;

export interface NativeConnectionStatusPersistenceItem<TPayload> {
  eventId: string;
  sourceId: string;
  sequence: number;
  payload: TPayload;
}

interface QueuedNativeConnectionStatusPersistenceItem<
  TPayload,
> extends NativeConnectionStatusPersistenceItem<TPayload> {
  attempt: number;
}

export interface NativeConnectionStatusPersistenceFailure<TPayload> {
  error: unknown;
  item: NativeConnectionStatusPersistenceItem<TPayload>;
  retrying: boolean;
}

export interface NativeConnectionStatusPersistenceQueueOptions<TPayload> {
  publish(item: NativeConnectionStatusPersistenceItem<TPayload>): Promise<void>;
  isRetryable?(error: unknown): boolean;
  onFailure?(failure: NativeConnectionStatusPersistenceFailure<TPayload>): void;
}

function errorCode(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error ?? 'unknown');
}

export function isRetryableNativeConnectionStatusPersistenceError(
  error: unknown
): boolean {
  const code = errorCode(error);
  return !(
    code.startsWith('worker_runtime_status_rejected:') ||
    code === 'worker_runtime_database_identity_invalid' ||
    code === 'worker_runtime_database_scope_rejected' ||
    code === 'worker_runtime_provider_invalid' ||
    code === 'worker_runtime_event_id_invalid' ||
    code === 'worker_runtime_connection_status_lease_proof_invalid'
  );
}

/**
 * Serial latest-wins queue for native provider snapshots. Retrying an
 * uncertain database result reuses the same event ID, making an acknowledged
 * or response-lost write idempotent without generating a second outbox row.
 */
export class NativeConnectionStatusPersistenceQueue<TPayload> {
  private pending:
    QueuedNativeConnectionStatusPersistenceItem<TPayload> | undefined;
  private active:
    QueuedNativeConnectionStatusPersistenceItem<TPayload> | undefined;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly idleWaiters = new Set<(idle: boolean) => void>();

  constructor(
    private readonly options: NativeConnectionStatusPersistenceQueueOptions<TPayload>
  ) {}

  enqueue(item: NativeConnectionStatusPersistenceItem<TPayload>): boolean {
    if (
      !item.sourceId ||
      !Number.isSafeInteger(item.sequence) ||
      item.sequence < 1
    ) {
      return false;
    }

    const newest = this.pending ?? this.active;
    if (
      newest?.sourceId === item.sourceId &&
      item.sequence <= newest.sequence
    ) {
      return false;
    }

    this.pending = { ...item, attempt: 0 };
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = undefined;
    }
    this.startDrain();
    return true;
  }

  async flush(timeoutMs = 5_000): Promise<boolean> {
    if (this.isIdle()) return true;
    return new Promise<boolean>((resolve) => {
      let settled = false;
      const finish = (idle: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        this.idleWaiters.delete(finish);
        resolve(idle);
      };
      const timeout = setTimeout(() => finish(false), timeoutMs);
      this.idleWaiters.add(finish);
    });
  }

  private startDrain(delayMs = 0): void {
    if (this.active || !this.pending) return;
    if (delayMs > 0) {
      if (this.retryTimer) return;
      this.retryTimer = setTimeout(() => {
        this.retryTimer = undefined;
        this.startDrain();
      }, delayMs);
      this.retryTimer.unref?.();
      return;
    }
    void this.drain();
  }

  private async drain(): Promise<void> {
    if (this.active || !this.pending) return;
    const item = this.pending;
    this.pending = undefined;
    this.active = item;
    let retryDelay = 0;
    try {
      await this.options.publish(item);
    } catch (error) {
      const superseded = Boolean(this.pending);
      const retryable =
        !superseded &&
        (this.options.isRetryable?.(error) ??
          isRetryableNativeConnectionStatusPersistenceError(error));
      if (retryable) {
        const attempt = item.attempt + 1;
        this.pending = { ...item, attempt };
        retryDelay =
          RETRY_DELAYS_MS[Math.min(attempt - 1, RETRY_DELAYS_MS.length - 1)];
      }
      this.options.onFailure?.({
        error,
        item,
        retrying: retryable,
      });
    } finally {
      this.active = undefined;
    }

    if (this.pending) {
      this.startDrain(retryDelay);
      return;
    }
    this.notifyIdle();
  }

  private isIdle(): boolean {
    return !this.active && !this.pending && !this.retryTimer;
  }

  private notifyIdle(): void {
    if (!this.isIdle()) return;
    for (const waiter of this.idleWaiters) waiter(true);
    this.idleWaiters.clear();
  }
}
