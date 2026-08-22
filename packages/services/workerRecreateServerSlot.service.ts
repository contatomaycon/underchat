import { inject, injectable } from 'tsyringe';
import Redis from 'ioredis';
import { v7 as uuidv7 } from 'uuid';
import { workerRecreateServerSlotKey } from '@core/common/functions/workerSelfHealingKeys';
import {
  createLockLeaseGuard,
  ILockLeaseContext,
} from '@core/common/functions/withLock';
import {
  workerLifecycleBudgets,
  WORKER_RECREATE_SERVER_SLOT_HOLD_TIMEOUT_ERROR_NAME,
} from '@core/common/functions/workerLifecycleBudgets';

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
  assertActive?: () => void;
  reservation?: boolean;
}

export type WorkerRecreateServerSlotReservationOptions = Pick<
  WorkerRecreateServerSlotAcquireOptions,
  'ttlMs' | 'assertActive'
>;

export interface WorkerRecreateServerSlotRunOptions extends WorkerRecreateServerSlotAcquireOptions {
  heartbeatIntervalMs?: number;
  maxHoldMs?: number;
  reservedSlotKey?: string;
  reservedSlotToken?: string;
}

/**
 * Allows the physical provisioning phase to release server capacity while
 * the caller continues connection/session reconciliation under its own
 * lifecycle fence. Releasing is idempotent and the slot context deliberately
 * becomes unfenced only after the exact-token Redis release succeeds.
 */
export interface WorkerRecreateServerSlotControl {
  release(): Promise<void>;
  isReleased(): boolean;
}

export interface WorkerRecreateServerSlotWaitOptions {
  pollIntervalMs?: number;
  timeoutMs?: number;
  assertActive?: () => void;
}

function positiveInteger(
  value: string | undefined,
  fallback: number,
  minimum: number
): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.max(minimum, Math.floor(parsed));
}

export class WorkerRecreateServerSlotHoldTimeoutError extends Error {
  constructor(serverId: string, slot: number, timeoutMs: number) {
    super(
      `Timed out holding recreate slot on server ${serverId}/${slot} after ${timeoutMs}ms`
    );
    this.name = WORKER_RECREATE_SERVER_SLOT_HOLD_TIMEOUT_ERROR_NAME;
  }
}

@injectable()
export class WorkerRecreateServerSlotService {
  private readonly defaultSlotCount = positiveInteger(
    process.env.WORKER_RECREATE_SERVER_SLOT_COUNT,
    2,
    1
  );
  private readonly defaultTtlMs = positiveInteger(
    process.env.WORKER_RECREATE_SERVER_SLOT_TTL_MS,
    2 * 60_000,
    60_000
  );
  /**
   * A reservation is created by the bulk dispatcher before a balancer has
   * adopted it. It must be deliberately short lived: unlike an active slot it
   * has no heartbeat owner and otherwise survives a rollout as a false,
   * server-wide capacity claim.
   */
  private readonly defaultReservationTtlMs = positiveInteger(
    process.env.WORKER_RECREATE_SERVER_SLOT_RESERVATION_TTL_MS,
    2 * 60_000,
    30_000
  );
  private readonly defaultAcquireTimeoutMs = workerLifecycleBudgets.slotWaitMs;
  private readonly defaultRetryDelayMs = positiveInteger(
    process.env.WORKER_RECREATE_SERVER_SLOT_RETRY_DELAY_MS,
    1000,
    100
  );
  private readonly defaultHeartbeatIntervalMs = positiveInteger(
    process.env.WORKER_RECREATE_SERVER_SLOT_HEARTBEAT_INTERVAL_MS,
    30_000,
    1000
  );
  private readonly defaultMaxHoldMs = workerLifecycleBudgets.slotMaxHoldMs;
  private readonly defaultWaitPollIntervalMs = positiveInteger(
    process.env.WORKER_RECREATE_SERVER_SLOT_WAIT_POLL_INTERVAL_MS,
    1000,
    250
  );
  private readonly defaultReleaseWaitTimeoutMs = positiveInteger(
    process.env.WORKER_RECREATE_SERVER_SLOT_RELEASE_WAIT_TIMEOUT_MS,
    Math.max(
      1000,
      this.defaultTtlMs - Math.max(5000, this.defaultWaitPollIntervalMs * 2)
    ),
    1000
  );
  private readonly releaseScript = `
    if redis.call("GET", KEYS[1]) == ARGV[1] then
      local deleted = redis.call("DEL", KEYS[1])
      if redis.call("GET", KEYS[2]) == ARGV[1] then
        redis.call("DEL", KEYS[2])
      end
      return deleted
    end
    return 0
  `;
  private readonly reserveScript = `
    if redis.call("SET", KEYS[1], ARGV[1], "PX", ARGV[2], "NX") then
      redis.call("SET", KEYS[2], ARGV[1], "PX", ARGV[2])
      return 1
    end
    return 0
  `;
  private readonly adoptReservationScript = `
    if redis.call("GET", KEYS[1]) ~= ARGV[1] then
      return 0
    end
    redis.call("PEXPIRE", KEYS[1], ARGV[2])
    if redis.call("GET", KEYS[2]) == ARGV[1] then
      redis.call("DEL", KEYS[2])
    end
    return 1
  `;
  private readonly clearStartupReservationScript = `
    local token = redis.call("GET", KEYS[2])
    if not token then
      return 0
    end

    local deleted = 0
    if redis.call("GET", KEYS[1]) == token then
      deleted = redis.call("UNLINK", KEYS[1])
    end
    redis.call("UNLINK", KEYS[2])
    return deleted
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

  getReservationTtlMs(): number {
    return this.defaultReservationTtlMs;
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
      const lease = await this.tryAcquireAvailableSlot(serverId, token, {
        ttlMs,
        assertActive: options.assertActive,
        reservation: options.reservation,
      });
      if (lease) {
        return lease;
      }

      options.assertActive?.();
      await this.sleep(retryDelayMs);
    }

    throw new Error(
      `Timed out waiting for recreate slot on server ${serverId}`
    );
  }

  /**
   * Attempts one exact-token reservation pass without waiting. Producers use
   * this before changing durable worker state so that server capacity is the
   * admission boundary, rather than an ever-growing Kafka backlog.
   */
  async tryReserve(
    serverId: string,
    token: string,
    options: WorkerRecreateServerSlotReservationOptions = {}
  ): Promise<WorkerRecreateServerSlotLease | null> {
    return this.tryAcquireAvailableSlot(serverId, token, {
      ...options,
      ttlMs: options.ttlMs ?? this.defaultReservationTtlMs,
      reservation: true,
    });
  }

  async withSlot<T>(
    input: {
      serverId: string;
      workerId: string;
      lifecycleOperationId?: string;
    },
    callback: (
      lease: WorkerRecreateServerSlotLease,
      context: ILockLeaseContext,
      control: WorkerRecreateServerSlotControl
    ) => Promise<T>,
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
        assertActive: options.assertActive,
      }));

    try {
      return await this.runWithHeartbeat(
        lease,
        async (context, control) => {
          options.assertActive?.();
          context.assertActive();
          const result = await callback(
            lease,
            {
              signal: context.signal,
              assertActive: () => {
                options.assertActive?.();
                context.assertActive();
              },
            },
            control
          );
          options.assertActive?.();
          if (!control.isReleased()) {
            context.assertActive();
          }
          return result;
        },
        options.heartbeatIntervalMs,
        options.ttlMs,
        options.maxHoldMs
      );
    } finally {
      await this.releaseBestEffort(lease);
    }
  }

  async waitForRelease(
    lease: WorkerRecreateServerSlotLease,
    options: WorkerRecreateServerSlotWaitOptions = {}
  ): Promise<void> {
    const startedAt = Date.now();
    const pollIntervalMs =
      options.pollIntervalMs ?? this.defaultWaitPollIntervalMs;
    const timeoutMs = Math.max(
      1,
      options.timeoutMs ?? this.defaultReleaseWaitTimeoutMs
    );

    while (true) {
      options.assertActive?.();

      if (Date.now() - startedAt >= timeoutMs) {
        throw new Error(
          `Timed out waiting for recreate slot release on server ${lease.serverId}`
        );
      }

      const current = await this.redis.get(lease.key);
      options.assertActive?.();
      if (current !== lease.token) {
        return;
      }

      const remainingMs = timeoutMs - (Date.now() - startedAt);
      await this.sleep(Math.min(pollIntervalMs, Math.max(1, remainingMs)));
    }
  }

  async release(lease: WorkerRecreateServerSlotLease): Promise<void> {
    await this.redis.eval(
      this.releaseScript,
      2,
      lease.key,
      this.reservationKey(lease.key),
      lease.token
    );
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

    await this.redis.eval(
      this.releaseScript,
      2,
      input.key,
      this.reservationKey(input.key),
      input.token
    );
  }

  /**
   * Only unadopted reservations are cleared during startup. Active slots do
   * not have the reservation marker and may still belong to a previous
   * balancer process finishing an external effect during a rolling restart.
   */
  async clearServerSlotsOnStartup(serverId: string): Promise<number> {
    let cleared = 0;
    for (let slot = 0; slot < this.defaultSlotCount; slot += 1) {
      const key = workerRecreateServerSlotKey(serverId, slot);
      cleared += Number(
        await this.redis.eval(
          this.clearStartupReservationScript,
          2,
          key,
          this.reservationKey(key)
        )
      );
    }
    return cleared;
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
    const renewed =
      Number(
        await this.redis.eval(
          this.adoptReservationScript,
          2,
          lease.key,
          this.reservationKey(lease.key),
          lease.token,
          input.ttlMs ?? this.defaultTtlMs
        )
      ) === 1;

    return renewed ? lease : null;
  }

  private reservationKey(slotKey: string): string {
    return `${slotKey}:reservation`;
  }

  private async tryAcquireAvailableSlot(
    serverId: string,
    token: string,
    options: Pick<
      WorkerRecreateServerSlotAcquireOptions,
      'ttlMs' | 'assertActive' | 'reservation'
    >
  ): Promise<WorkerRecreateServerSlotLease | null> {
    const ttlMs = options.ttlMs ?? this.defaultTtlMs;
    options.assertActive?.();

    for (let slot = 0; slot < this.defaultSlotCount; slot += 1) {
      options.assertActive?.();
      const key = workerRecreateServerSlotKey(serverId, slot);
      const acquired = options.reservation
        ? Number(
            await this.redis.eval(
              this.reserveScript,
              2,
              key,
              this.reservationKey(key),
              token,
              ttlMs
            )
          ) === 1
        : (await this.redis.set(key, token, 'PX', ttlMs, 'NX')) === 'OK';

      if (!acquired) {
        continue;
      }

      const lease: WorkerRecreateServerSlotLease = {
        key,
        token,
        serverId,
        slot,
        reserved: false,
      };

      try {
        options.assertActive?.();
        return lease;
      } catch (error) {
        await this.releaseBestEffort(lease);
        throw error;
      }
    }

    return null;
  }

  private async runWithHeartbeat<T>(
    lease: WorkerRecreateServerSlotLease,
    callback: (
      context: ILockLeaseContext,
      control: WorkerRecreateServerSlotControl
    ) => Promise<T>,
    heartbeatIntervalMs = this.defaultHeartbeatIntervalMs,
    ttlMs = this.defaultTtlMs,
    maxHoldMs = this.defaultMaxHoldMs
  ): Promise<T> {
    const guard = createLockLeaseGuard(
      this.redis,
      lease.key,
      `worker recreate slot ${lease.serverId}/${lease.slot}`,
      lease.token,
      ttlMs,
      { renewIntervalMs: heartbeatIntervalMs }
    );
    const holdTimeoutError = new WorkerRecreateServerSlotHoldTimeoutError(
      lease.serverId,
      lease.slot,
      maxHoldMs
    );
    const holdTimeoutController = new AbortController();
    const slotContextController = new AbortController();
    let holdTimedOut = false;
    let released = false;
    let holdTimer: ReturnType<typeof setTimeout> | null = setTimeout(
      () => {
        holdTimedOut = true;
        holdTimeoutController.abort(holdTimeoutError);
        /*
         * Stop renewing immediately. The exact-token release in withSlot keeps
         * a later owner safe, while the short TTL bounds recovery when an
         * external call ignores AbortSignal and never returns.
         */
        guard.deactivate();
      },
      Math.max(1, maxHoldMs)
    );
    holdTimer.unref?.();
    const forwardLeaseAbort = (): void => {
      if (!released && !slotContextController.signal.aborted) {
        slotContextController.abort(guard.context.signal.reason);
      }
    };
    const forwardHoldAbort = (): void => {
      if (!released && !slotContextController.signal.aborted) {
        slotContextController.abort(holdTimeoutController.signal.reason);
      }
    };
    guard.context.signal.addEventListener('abort', forwardLeaseAbort, {
      once: true,
    });
    holdTimeoutController.signal.addEventListener('abort', forwardHoldAbort, {
      once: true,
    });
    const context: ILockLeaseContext = {
      signal: slotContextController.signal,
      assertActive: () => {
        if (released) {
          return;
        }
        if (holdTimedOut) {
          throw holdTimeoutError;
        }
        guard.assertActive();
      },
    };
    const control: WorkerRecreateServerSlotControl = {
      isReleased: () => released,
      release: async () => {
        if (released) {
          return;
        }
        context.assertActive();
        await guard.stop();
        context.assertActive();
        await this.release(lease);
        released = true;
        if (holdTimer !== null) {
          clearTimeout(holdTimer);
          holdTimer = null;
        }
      },
    };
    const observedCallback = Promise.resolve()
      .then(() => callback(context, control))
      .then(
        (value) => ({ kind: 'completed' as const, value }),
        (error: unknown) => ({ kind: 'failed' as const, error })
      );
    const holdTimeout = new Promise<{ kind: 'timed_out' }>((resolve) => {
      holdTimeoutController.signal.addEventListener(
        'abort',
        () => resolve({ kind: 'timed_out' }),
        { once: true }
      );
    });

    try {
      context.assertActive();
      const outcome = await Promise.race([observedCallback, holdTimeout]);
      if (outcome.kind === 'timed_out') {
        /*
         * observedCallback always settles to a value, including late
         * rejection, so abandoning it here cannot create an unhandled
         * rejection. Callers must fence every continuation with the supplied
         * context; the aborted signal prevents post-timeout effects.
         */
        throw holdTimeoutError;
      }
      if (outcome.kind === 'failed') {
        throw outcome.error;
      }
      if (!released) {
        context.assertActive();
        await guard.stop();
        context.assertActive();
      }
      return outcome.value;
    } finally {
      if (holdTimer !== null) {
        clearTimeout(holdTimer);
      }
      guard.context.signal.removeEventListener('abort', forwardLeaseAbort);
      holdTimeoutController.signal.removeEventListener(
        'abort',
        forwardHoldAbort
      );
      guard.deactivate();
      await guard.stop();
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
