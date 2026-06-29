import { inject, injectable } from 'tsyringe';
import Redis from 'ioredis';
import { v7 as uuidv7 } from 'uuid';
import { workerRecreateServerSlotKey } from '@core/common/functions/workerSelfHealingKeys';

export interface WorkerRecreateServerSlotLease {
  key: string;
  token: string;
  serverId: string;
  slot: number;
  reserved: boolean;
}

export interface WorkerRecreateServerSlotAcquireOptions {
  ttlMs?: number;
  acquireTimeoutMs?: number;
  retryDelayMs?: number;
}

export interface WorkerRecreateServerSlotRunOptions extends WorkerRecreateServerSlotAcquireOptions {
  heartbeatIntervalMs?: number;
  reservedSlotKey?: string;
  reservedSlotToken?: string;
}

export interface WorkerRecreateServerSlotWaitOptions {
  ttlMs?: number;
  heartbeatIntervalMs?: number;
  pollIntervalMs?: number;
  timeoutMs?: number;
}

@injectable()
export class WorkerRecreateServerSlotService {
  private readonly defaultSlotCount = Math.max(
    1,
    Number(process.env.WORKER_RECREATE_SERVER_SLOT_COUNT) || 2
  );
  private readonly defaultTtlMs = Math.max(
    60_000,
    Number(process.env.WORKER_RECREATE_SERVER_SLOT_TTL_MS) || 20 * 60_000
  );
  private readonly defaultAcquireTimeoutMs = Math.max(
    60_000,
    Number(process.env.WORKER_RECREATE_SERVER_SLOT_WAIT_MS) || 30 * 60_000
  );
  private readonly defaultRetryDelayMs = Math.max(
    100,
    Number(process.env.WORKER_RECREATE_SERVER_SLOT_RETRY_DELAY_MS) || 1000
  );
  private readonly defaultHeartbeatIntervalMs = Math.max(
    1000,
    Number(process.env.WORKER_RECREATE_SERVER_SLOT_HEARTBEAT_INTERVAL_MS) ||
      30_000
  );
  private readonly defaultWaitPollIntervalMs = Math.max(
    250,
    Number(process.env.WORKER_RECREATE_SERVER_SLOT_WAIT_POLL_INTERVAL_MS) ||
      1000
  );
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

  getSlotCount(): number {
    return this.defaultSlotCount;
  }

  buildToken(workerId: string, lifecycleOperationId?: string): string {
    return `${workerId}:${lifecycleOperationId ?? uuidv7()}`;
  }

  async acquire(
    serverId: string,
    token: string,
    options: WorkerRecreateServerSlotAcquireOptions = {}
  ): Promise<WorkerRecreateServerSlotLease> {
    const ttlMs = options.ttlMs ?? this.defaultTtlMs;
    const acquireTimeoutMs =
      options.acquireTimeoutMs ?? this.defaultAcquireTimeoutMs;
    const retryDelayMs = options.retryDelayMs ?? this.defaultRetryDelayMs;
    const startedAt = Date.now();

    while (Date.now() - startedAt <= acquireTimeoutMs) {
      for (let slot = 0; slot < this.defaultSlotCount; slot += 1) {
        const key = workerRecreateServerSlotKey(serverId, slot);
        const result = await this.redis.set(key, token, 'PX', ttlMs, 'NX');

        if (result === 'OK') {
          return {
            key,
            token,
            serverId,
            slot,
            reserved: false,
          };
        }
      }

      await this.sleep(retryDelayMs);
    }

    throw new Error(
      `Timed out waiting for recreate slot on server ${serverId}`
    );
  }

  async withSlot<T>(
    input: {
      serverId: string;
      workerId: string;
      lifecycleOperationId?: string;
    },
    callback: (lease: WorkerRecreateServerSlotLease) => Promise<T>,
    options: WorkerRecreateServerSlotRunOptions = {}
  ): Promise<T> {
    const reservedLease = await this.tryAdoptReservedSlot(input.serverId, {
      key: options.reservedSlotKey,
      token: options.reservedSlotToken,
      ttlMs: options.ttlMs,
    });
    const token =
      options.reservedSlotToken ??
      this.buildToken(input.workerId, input.lifecycleOperationId);
    const lease =
      reservedLease ??
      (await this.acquire(input.serverId, token, {
        ttlMs: options.ttlMs,
        acquireTimeoutMs: options.acquireTimeoutMs,
        retryDelayMs: options.retryDelayMs,
      }));

    return this.runWithHeartbeat(
      lease,
      async () => {
        try {
          return await callback(lease);
        } finally {
          await this.releaseBestEffort(lease);
        }
      },
      options.heartbeatIntervalMs,
      options.ttlMs
    );
  }

  async waitForRelease(
    lease: WorkerRecreateServerSlotLease,
    options: WorkerRecreateServerSlotWaitOptions = {}
  ): Promise<void> {
    await this.runWithHeartbeat(
      lease,
      async () => {
        const startedAt = Date.now();
        const pollIntervalMs =
          options.pollIntervalMs ?? this.defaultWaitPollIntervalMs;

        while (true) {
          const current = await this.redis.get(lease.key);
          if (current !== lease.token) {
            return;
          }

          if (
            options.timeoutMs !== undefined &&
            Date.now() - startedAt > options.timeoutMs
          ) {
            throw new Error(
              `Timed out waiting for recreate slot release on server ${lease.serverId}`
            );
          }

          await this.sleep(pollIntervalMs);
        }
      },
      options.heartbeatIntervalMs,
      options.ttlMs
    );
  }

  async release(lease: WorkerRecreateServerSlotLease): Promise<void> {
    await this.redis.eval(this.releaseScript, 1, lease.key, lease.token);
  }

  private async releaseBestEffort(
    lease: WorkerRecreateServerSlotLease
  ): Promise<void> {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        await this.release(lease);
        return;
      } catch {
        if (attempt < 3) {
          await this.sleep(250);
        }
      }
    }
  }

  async releaseReservedSlot(input: {
    serverId?: string;
    key?: string;
    token?: string;
  }): Promise<void> {
    if (!input.key || !input.token) {
      return;
    }

    if (input.serverId && this.parseSlot(input.serverId, input.key) === null) {
      return;
    }

    await this.redis.eval(this.releaseScript, 1, input.key, input.token);
  }

  private async tryAdoptReservedSlot(
    serverId: string,
    input: {
      key?: string;
      token?: string;
      ttlMs?: number;
    }
  ): Promise<WorkerRecreateServerSlotLease | null> {
    if (!input.key || !input.token) {
      return null;
    }

    const slot = this.parseSlot(serverId, input.key);
    if (slot === null) {
      return null;
    }

    const lease: WorkerRecreateServerSlotLease = {
      key: input.key,
      token: input.token,
      serverId,
      slot,
      reserved: true,
    };
    const renewed = await this.heartbeat(lease, input.ttlMs);

    return renewed ? lease : null;
  }

  private async runWithHeartbeat<T>(
    lease: WorkerRecreateServerSlotLease,
    callback: () => Promise<T>,
    heartbeatIntervalMs = this.defaultHeartbeatIntervalMs,
    ttlMs = this.defaultTtlMs
  ): Promise<T> {
    const heartbeat = setInterval(() => {
      void this.heartbeat(lease, ttlMs).catch(() => undefined);
    }, heartbeatIntervalMs);
    heartbeat.unref?.();

    try {
      return await callback();
    } finally {
      clearInterval(heartbeat);
    }
  }

  private async heartbeat(
    lease: WorkerRecreateServerSlotLease,
    ttlMs = this.defaultTtlMs
  ): Promise<boolean> {
    const result = await this.redis.eval(
      this.heartbeatScript,
      1,
      lease.key,
      lease.token,
      ttlMs
    );

    return Number(result) === 1;
  }

  private parseSlot(serverId: string, key: string): number | null {
    const prefix = `worker:recreate:server:${serverId}:slot:`;
    if (!key.startsWith(prefix)) {
      return null;
    }

    const slot = Number(key.slice(prefix.length));
    if (!Number.isInteger(slot) || slot < 0 || slot >= this.defaultSlotCount) {
      return null;
    }

    return slot;
  }

  private async sleep(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }
}
