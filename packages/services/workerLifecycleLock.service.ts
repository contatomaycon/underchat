import { inject, injectable } from 'tsyringe';
import Redis from 'ioredis';
import { randomUUID } from 'node:crypto';

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
      void this.heartbeat(lease, ttlMs).catch(() => {});
    }, heartbeatIntervalMs);

    try {
      return await callback();
    } finally {
      clearInterval(heartbeat);
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
      const acquired = await this.redis.set(key, owner, 'PX', ttlMs, 'NX');

      if (acquired === 'OK') {
        return { key, owner };
      }

      await this.sleep(retryDelayMs);
    }

    throw new Error(
      `Worker lifecycle lock timeout for ${workerId} (${operation})`
    );
  }

  private async heartbeat(
    lease: WorkerLifecycleLockLease,
    ttlMs: number
  ): Promise<void> {
    await this.redis.eval(
      this.heartbeatScript,
      1,
      lease.key,
      lease.owner,
      ttlMs
    );
  }

  private async release(lease: WorkerLifecycleLockLease): Promise<void> {
    await this.redis.eval(this.releaseScript, 1, lease.key, lease.owner);
  }

  private lockKey(workerId: string): string {
    return `underchat:worker:lifecycle:lock:${workerId}`;
  }

  private async sleep(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }
}
