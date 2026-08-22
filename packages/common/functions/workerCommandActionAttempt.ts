export type WorkerCommandActionRequestStatus =
  'accepted' | 'unknown' | 'terminal' | 'rejected';

export interface WorkerCommandActionRequestResult {
  status: WorkerCommandActionRequestStatus;
  operationId: string;
}

export interface WorkerCommandActionAttempt {
  operationId: string;
  retryOf?: string;
}

type TrackedAttempt = WorkerCommandActionAttempt & {
  state: 'active' | 'unknown' | 'terminal';
  createdAtMs: number;
  retryUntilMs: number;
  expiresAtMs: number;
};

export interface WorkerCommandActionAttemptSnapshotV1 {
  schemaVersion: 1;
  attempts: Array<{
    key: string;
    operationId: string;
    retryOf?: string;
    state: 'active' | 'unknown' | 'terminal';
    createdAtMs: number;
    retryUntilMs: number;
    expiresAtMs: number;
  }>;
}

const PUBLIC_RETRY_WINDOW_MS = 2 * 60 * 1000;
const ACTION_IDENTITY_RETENTION_MS = 24 * 60 * 60 * 1000;
const MAX_TRACKED_ATTEMPTS = 512;

/**
 * Keeps an HTTP action on the exact same operation while broker acceptance is
 * unknown. A terminal retry is allocated lazily, only when the user performs
 * another explicit action, and points back to the previous operation.
 */
export class WorkerCommandActionAttemptRegistry {
  private readonly attempts = new Map<string, TrackedAttempt>();

  constructor(
    private readonly createOperationId: () => string,
    private readonly now: () => number = Date.now
  ) {}

  public begin(key: string): WorkerCommandActionAttempt {
    const normalizedKey = this.requireKey(key);
    const nowMs = this.requireNow();
    this.prune(nowMs);
    const current = this.attempts.get(normalizedKey);
    if (current?.state === 'active' || current?.state === 'unknown') {
      if (nowMs < current.retryUntilMs) {
        return this.publicAttempt(current);
      }
      current.state = 'terminal';
    }

    const operationId = this.requireOperationId(this.createOperationId());
    const next: TrackedAttempt = {
      operationId,
      ...(current?.state === 'terminal'
        ? { retryOf: current.operationId }
        : {}),
      state: 'active',
      createdAtMs: nowMs,
      retryUntilMs: nowMs + PUBLIC_RETRY_WINDOW_MS,
      expiresAtMs: nowMs + ACTION_IDENTITY_RETENTION_MS,
    };
    this.attempts.set(normalizedKey, next);
    this.enforceCapacity();
    return this.publicAttempt(next);
  }

  public settle(key: string, result: WorkerCommandActionRequestResult): void {
    const normalizedKey = this.requireKey(key);
    const current = this.attempts.get(normalizedKey);
    if (!current || current.operationId !== result.operationId) return;

    if (result.status === 'accepted' || result.status === 'rejected') {
      this.attempts.delete(normalizedKey);
      return;
    }

    current.state = result.status;
  }

  public clear(): void {
    this.attempts.clear();
  }

  public snapshot(): WorkerCommandActionAttemptSnapshotV1 {
    this.prune(this.requireNow());
    return {
      schemaVersion: 1,
      attempts: [...this.attempts.entries()].map(([key, attempt]) => ({
        key,
        operationId: attempt.operationId,
        ...(attempt.retryOf ? { retryOf: attempt.retryOf } : {}),
        state: attempt.state,
        createdAtMs: attempt.createdAtMs,
        retryUntilMs: attempt.retryUntilMs,
        expiresAtMs: attempt.expiresAtMs,
      })),
    };
  }

  public restore(value: unknown): void {
    if (!value || typeof value !== 'object') return;
    const snapshot = value as Partial<WorkerCommandActionAttemptSnapshotV1>;
    if (snapshot.schemaVersion !== 1 || !Array.isArray(snapshot.attempts))
      return;

    const nowMs = this.requireNow();
    for (const raw of snapshot.attempts.slice(-MAX_TRACKED_ATTEMPTS)) {
      if (!raw || typeof raw !== 'object') continue;
      const candidate = raw as Partial<
        WorkerCommandActionAttemptSnapshotV1['attempts'][number]
      >;
      try {
        const key = this.requireKey(candidate.key ?? '');
        const operationId = this.requireOperationId(
          candidate.operationId ?? ''
        );
        if (
          candidate.state !== 'active' &&
          candidate.state !== 'unknown' &&
          candidate.state !== 'terminal'
        ) {
          continue;
        }
        if (
          !Number.isSafeInteger(candidate.createdAtMs) ||
          !Number.isSafeInteger(candidate.retryUntilMs) ||
          !Number.isSafeInteger(candidate.expiresAtMs) ||
          (candidate.expiresAtMs ?? 0) <= nowMs ||
          (candidate.retryUntilMs ?? 0) <= (candidate.createdAtMs ?? 0) ||
          (candidate.expiresAtMs ?? 0) <= (candidate.retryUntilMs ?? 0)
        ) {
          continue;
        }
        const restored: TrackedAttempt = {
          operationId,
          ...(candidate.retryOf
            ? { retryOf: this.requireOperationId(candidate.retryOf) }
            : {}),
          // A process may have died while an HTTP request was active. On
          // restore that result is necessarily unknown, never safely rejected.
          state: candidate.state === 'active' ? 'unknown' : candidate.state,
          createdAtMs: candidate.createdAtMs as number,
          retryUntilMs: candidate.retryUntilMs as number,
          expiresAtMs: candidate.expiresAtMs as number,
        };
        this.attempts.set(key, restored);
      } catch {
        // Corrupt client storage is ignored entry-by-entry.
      }
    }
    this.prune(nowMs);
    this.enforceCapacity();
  }

  private publicAttempt(attempt: TrackedAttempt): WorkerCommandActionAttempt {
    return {
      operationId: attempt.operationId,
      ...(attempt.retryOf ? { retryOf: attempt.retryOf } : {}),
    };
  }

  private requireKey(value: string): string {
    const normalized = value.trim();
    if (!normalized) throw new Error('worker_command_action_key_invalid');
    return normalized;
  }

  private requireOperationId(value: string): string {
    const normalized = value.trim();
    if (!normalized) {
      throw new Error('worker_command_action_operation_id_invalid');
    }
    return normalized;
  }

  private requireNow(): number {
    const value = this.now();
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error('worker_command_action_clock_invalid');
    }
    return value;
  }

  private prune(nowMs: number): void {
    for (const [key, attempt] of this.attempts) {
      if (nowMs >= attempt.expiresAtMs) this.attempts.delete(key);
    }
  }

  private enforceCapacity(): void {
    if (this.attempts.size <= MAX_TRACKED_ATTEMPTS) return;
    const oldest = [...this.attempts.entries()].sort(
      ([, left], [, right]) => left.createdAtMs - right.createdAtMs
    );
    for (const [key] of oldest.slice(
      0,
      this.attempts.size - MAX_TRACKED_ATTEMPTS
    )) {
      this.attempts.delete(key);
    }
  }
}
