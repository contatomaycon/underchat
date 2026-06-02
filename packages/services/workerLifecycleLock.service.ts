import { inject, injectable } from 'tsyringe';
import Redis from 'ioredis';
import { randomUUID } from 'node:crypto';
import { getErrorMessage } from '@core/common/functions/toError';
import { recordConnectionLifecycle } from '@core/plugins/telemetry/connectionLifecycleDebug';

interface WorkerLifecycleLockOptions {
  ttlMs?: number;
  acquireTimeoutMs?: number;
  retryDelayMs?: number;
  heartbeatIntervalMs?: number;
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
  private readonly heartbeatScript = `
    if redis.call("GET", KEYS[1]) == ARGV[1] then
      return redis.call("PEXPIRE", KEYS[1], ARGV[2])
    end
    return 0
  `;

  constructor(@inject('Redis') private readonly redis: Redis) {}

  async withLock<T>(
    workerId: string,
    operation: string,
    callback: () => Promise<T>,
    options: WorkerLifecycleLockOptions = {}
  ): Promise<T> {
    const ttlMs = options.ttlMs ?? this.defaultTtlMs;
    const heartbeatIntervalMs =
      options.heartbeatIntervalMs ?? this.defaultHeartbeatIntervalMs;
    const lease = await this.acquire(workerId, operation, {
      ...options,
      ttlMs,
    });
    const heartbeat = setInterval(() => {
      void this.heartbeat(lease, workerId, operation, ttlMs).catch((err) => {
        recordConnectionLifecycle({
          stage: 'connection.balancer.worker_lifecycle_lock_heartbeat_error',
          decision: operation,
          outcome: 'error',
          reason: 'heartbeat_failed',
          level: 'error',
          worker_id: workerId,
          lock_key: lease.key,
          lock_owner: lease.owner,
          lock_ttl_ms: ttlMs,
          error: getErrorMessage(err),
        });
      });
    }, heartbeatIntervalMs);

    try {
      return await callback();
    } finally {
      clearInterval(heartbeat);
      await this.release(lease, workerId, operation).catch((err) => {
        recordConnectionLifecycle({
          stage: 'connection.balancer.worker_lifecycle_lock_release_error',
          decision: operation,
          outcome: 'error',
          reason: 'release_failed',
          level: 'error',
          worker_id: workerId,
          lock_key: lease.key,
          lock_owner: lease.owner,
          error: getErrorMessage(err),
        });
      });
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
    let attempt = 0;

    recordConnectionLifecycle({
      stage: 'connection.balancer.worker_lifecycle_lock_wait',
      decision: operation,
      outcome: 'waiting',
      worker_id: workerId,
      lock_key: key,
      lock_owner: owner,
      lock_ttl_ms: ttlMs,
      lock_acquire_timeout_ms: acquireTimeoutMs,
    });

    while (Date.now() - startedAt <= acquireTimeoutMs) {
      attempt += 1;
      const acquired = await this.redis.set(key, owner, 'PX', ttlMs, 'NX');

      if (acquired === 'OK') {
        recordConnectionLifecycle({
          stage: 'connection.balancer.worker_lifecycle_lock_acquired',
          decision: operation,
          outcome: 'acquired',
          worker_id: workerId,
          lock_key: key,
          lock_owner: owner,
          lock_ttl_ms: ttlMs,
          lock_wait_ms: Date.now() - startedAt,
          lock_attempt: attempt,
        });

        return { key, owner };
      }

      await this.sleep(retryDelayMs);
    }

    recordConnectionLifecycle({
      stage: 'connection.balancer.worker_lifecycle_lock_timeout',
      decision: operation,
      outcome: 'timeout',
      reason: 'lock_acquire_timeout',
      level: 'error',
      worker_id: workerId,
      lock_key: key,
      lock_owner: owner,
      lock_wait_ms: Date.now() - startedAt,
      lock_attempt: attempt,
      lock_acquire_timeout_ms: acquireTimeoutMs,
    });

    throw new Error(
      `Worker lifecycle lock timeout for ${workerId} (${operation})`
    );
  }

  private async heartbeat(
    lease: WorkerLifecycleLockLease,
    workerId: string,
    operation: string,
    ttlMs: number
  ): Promise<void> {
    const renewed = await this.redis.eval(
      this.heartbeatScript,
      1,
      lease.key,
      lease.owner,
      ttlMs
    );

    if (Number(renewed) !== 1) {
      recordConnectionLifecycle({
        stage: 'connection.balancer.worker_lifecycle_lock_heartbeat_lost',
        decision: operation,
        outcome: 'lost',
        reason: 'lock_owner_mismatch',
        level: 'error',
        worker_id: workerId,
        lock_key: lease.key,
        lock_owner: lease.owner,
        lock_ttl_ms: ttlMs,
      });
    }
  }

  private async release(
    lease: WorkerLifecycleLockLease,
    workerId: string,
    operation: string
  ): Promise<void> {
    const released = await this.redis.eval(
      this.releaseScript,
      1,
      lease.key,
      lease.owner
    );

    recordConnectionLifecycle({
      stage: 'connection.balancer.worker_lifecycle_lock_released',
      decision: operation,
      outcome: Number(released) === 1 ? 'released' : 'skipped',
      reason: Number(released) === 1 ? undefined : 'lock_owner_mismatch',
      worker_id: workerId,
      lock_key: lease.key,
      lock_owner: lease.owner,
    });
  }

  private lockKey(workerId: string): string {
    return `underchat:worker:lifecycle:lock:${workerId}`;
  }

  private async sleep(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }
}
