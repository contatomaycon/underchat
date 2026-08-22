import { inject, injectable } from 'tsyringe';
import Redis from 'ioredis';
import { randomUUID } from 'node:crypto';
import {
  createLockLeaseGuard,
  ILockLeaseContext,
} from '@core/common/functions/withLock';

interface WorkerLifecycleLockOptions {
  ttlMs?: number;
  acquireTimeoutMs?: number;
  retryDelayMs?: number;
  heartbeatIntervalMs?: number;
  signal?: AbortSignal;
}

interface WorkerLifecycleLockLease {
  key: string;
  owner: string;
}

@injectable()
export class WorkerLifecycleLockService {
  private readonly defaultTtlMs = 180_000;
  private readonly defaultAcquireTimeoutMs = 120_000;
  private readonly defaultRetryDelayMs = 250;
  private readonly defaultHeartbeatIntervalMs = 30_000;
  private readonly releaseScript = `
    if redis.call("GET", KEYS[1]) == ARGV[1] then
      return redis.call("DEL", KEYS[1])
    end
    return 0
  `;
  private readonly boundRedriveClaimTtlScript = `
    -- worker-lifecycle-redrive-bound-ttl-v1
    local owner = redis.call("GET", KEYS[1])
    local operation_id = ARGV[1]
    local token_prefix = operation_id .. ":"
    if owner ~= operation_id and string.sub(owner or "", 1, string.len(token_prefix)) ~= token_prefix then
      return 0
    end
    local requested_ttl = tonumber(ARGV[2])
    if not requested_ttl or requested_ttl < 1 then
      return 0
    end
    local current_ttl = redis.call("PTTL", KEYS[1])
    if current_ttl == -1 or current_ttl > requested_ttl then
      return redis.call("PEXPIRE", KEYS[1], requested_ttl)
    end
    return 0
  `;

  constructor(@inject('Redis') private readonly redis: Redis) {}

  async isLocked(workerId: string): Promise<boolean> {
    return (await this.redis.pttl(this.lockKey(workerId))) > 0;
  }

  async tryClaimRedrive(
    workerId: string,
    lifecycleOperationId: string,
    ttlMs: number
  ): Promise<string | null> {
    const key = this.redriveKey(workerId, lifecycleOperationId);
    const boundedTtlMs = Math.max(1, ttlMs);
    const claimToken = `${lifecycleOperationId}:${randomUUID()}`;
    const result = await this.redis.set(
      key,
      claimToken,
      'PX',
      boundedTtlMs,
      'NX'
    );
    if (result === 'OK') {
      return claimToken;
    }

    /*
     * Redrive callers share this operation-scoped cooldown. A faster recovery
     * loop may request a shorter bound than an earlier monitor without stealing
     * the claim or publishing concurrently. Only the same operation can
     * monotonically shorten its TTL; the next loop may acquire after expiry.
     */
    await this.redis.eval(
      this.boundRedriveClaimTtlScript,
      1,
      key,
      lifecycleOperationId,
      boundedTtlMs
    );
    return null;
  }

  async releaseRedriveClaim(
    workerId: string,
    lifecycleOperationId: string,
    claimToken?: string
  ): Promise<boolean> {
    if (!this.isOwnedRedriveClaimToken(lifecycleOperationId, claimToken)) {
      return false;
    }
    const released = await this.redis.eval(
      this.releaseScript,
      1,
      this.redriveKey(workerId, lifecycleOperationId),
      claimToken
    );
    return Number(released) === 1;
  }

  private isOwnedRedriveClaimToken(
    lifecycleOperationId: string,
    claimToken: string | undefined
  ): claimToken is string {
    if (!claimToken?.startsWith(`${lifecycleOperationId}:`)) {
      return false;
    }
    const ownerId = claimToken.slice(lifecycleOperationId.length + 1);
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      ownerId
    );
  }

  async withLock<T>(
    workerId: string,
    operation: string,
    callback: (context: ILockLeaseContext) => Promise<T>,
    options: WorkerLifecycleLockOptions = {}
  ): Promise<T> {
    const ttlMs = options.ttlMs ?? this.defaultTtlMs;
    const heartbeatIntervalMs =
      options.heartbeatIntervalMs ?? this.defaultHeartbeatIntervalMs;
    const lease = await this.acquire(workerId, operation, {
      ...options,
      ttlMs,
    });
    const guard = createLockLeaseGuard(
      this.redis,
      lease.key,
      `worker lifecycle ${workerId}`,
      lease.owner,
      ttlMs,
      { renewIntervalMs: heartbeatIntervalMs }
    );
    const context = this.createLeaseContext(
      guard.context,
      guard.assertActive,
      options.signal,
      workerId,
      operation
    );

    try {
      context.assertActive();
      const result = await this.runObservedCallback(
        callback,
        context,
        workerId,
        operation
      );
      context.assertActive();
      await guard.stop();
      context.assertActive();
      return result;
    } finally {
      guard.deactivate();
      await guard.stop();
      await this.release(lease).catch(() => {});
    }
  }

  private async acquire(
    workerId: string,
    operation: string,
    options: WorkerLifecycleLockOptions
  ): Promise<WorkerLifecycleLockLease> {
    const key = this.lockKey(workerId);
    const owner = `${process.pid}:${randomUUID()}`;
    const ttlMs = options.ttlMs ?? this.defaultTtlMs;
    const acquireTimeoutMs =
      options.acquireTimeoutMs ?? this.defaultAcquireTimeoutMs;
    const retryDelayMs = options.retryDelayMs ?? this.defaultRetryDelayMs;
    const startedAt = Date.now();

    while (Date.now() - startedAt <= acquireTimeoutMs) {
      this.assertSignalActive(options.signal, workerId, operation);
      const acquired = await this.redis.set(key, owner, 'PX', ttlMs, 'NX');

      if (acquired === 'OK') {
        const lease = { key, owner };
        try {
          this.assertSignalActive(options.signal, workerId, operation);
          return lease;
        } catch (error) {
          await this.release(lease).catch(() => {});
          throw error;
        }
      }

      await this.sleep(retryDelayMs, options.signal, workerId, operation);
    }

    throw new Error(
      `Worker lifecycle lock timeout for ${workerId} (${operation})`
    );
  }

  private async release(lease: WorkerLifecycleLockLease): Promise<void> {
    await this.redis.eval(this.releaseScript, 1, lease.key, lease.owner);
  }

  private lockKey(workerId: string): string {
    return `underchat:worker:lifecycle:lock:${workerId}`;
  }

  private redriveKey(workerId: string, lifecycleOperationId: string): string {
    return `underchat:worker:lifecycle:redrive:${workerId}:${lifecycleOperationId}`;
  }

  private createLeaseContext(
    guardContext: ILockLeaseContext,
    assertGuardActive: () => void,
    externalSignal: AbortSignal | undefined,
    workerId: string,
    operation: string
  ): ILockLeaseContext {
    if (!externalSignal) {
      return guardContext;
    }

    return {
      signal: AbortSignal.any([guardContext.signal, externalSignal]),
      assertActive: () => {
        this.assertSignalActive(externalSignal, workerId, operation);
        assertGuardActive();
      },
    };
  }

  private async runObservedCallback<T>(
    callback: (context: ILockLeaseContext) => Promise<T>,
    context: ILockLeaseContext,
    workerId: string,
    operation: string
  ): Promise<T> {
    const observedCallback = Promise.resolve()
      .then(() => {
        context.assertActive();
        return callback(context);
      })
      .then(
        (value) => ({ kind: 'completed' as const, value }),
        (error: unknown) => ({ kind: 'failed' as const, error })
      );
    let removeAbortListener = (): void => undefined;
    const aborted = new Promise<{ kind: 'aborted'; error: unknown }>(
      (resolve) => {
        const onAbort = (): void => {
          resolve({
            kind: 'aborted',
            error: this.abortReason(context.signal, workerId, operation),
          });
        };
        removeAbortListener = (): void => {
          context.signal.removeEventListener('abort', onAbort);
        };
        if (context.signal.aborted) {
          onAbort();
          return;
        }
        context.signal.addEventListener('abort', onAbort, { once: true });
      }
    );

    try {
      const outcome = await Promise.race([observedCallback, aborted]);
      if (outcome.kind !== 'completed') {
        throw outcome.error;
      }
      return outcome.value;
    } finally {
      removeAbortListener();
    }
  }

  private assertSignalActive(
    signal: AbortSignal | undefined,
    workerId: string,
    operation: string
  ): void {
    if (signal?.aborted) {
      throw this.abortReason(signal, workerId, operation);
    }
  }

  private abortReason(
    signal: AbortSignal,
    workerId: string,
    operation: string
  ): unknown {
    return (
      signal.reason ??
      new Error(`Worker lifecycle lock aborted for ${workerId} (${operation})`)
    );
  }

  private async sleep(
    ms: number,
    signal: AbortSignal | undefined,
    workerId: string,
    operation: string
  ): Promise<void> {
    this.assertSignalActive(signal, workerId, operation);
    if (!signal) {
      await new Promise((resolve) => setTimeout(resolve, ms));
      return;
    }

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        signal.removeEventListener('abort', onAbort);
        resolve();
      }, ms);
      const onAbort = (): void => {
        clearTimeout(timer);
        reject(this.abortReason(signal, workerId, operation));
      };
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });
    });
  }
}
