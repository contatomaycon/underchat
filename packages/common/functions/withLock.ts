import Redis from 'ioredis';
import { v7 as uuidv7 } from 'uuid';
import { extendLock } from './extendLock';
import { releaseLock } from './releaseLock';
import { delay } from './delay';
import {
  isRedisConnectionClosed,
  CONNECTION_CLOSED_ERROR_MSG,
} from '@core/plugins/redis';

export class LockAcquisitionTimeoutError extends Error {
  constructor(lockKey: string, timeoutMs: number) {
    super(`Failed to acquire lock "${lockKey}" after ${timeoutMs}ms`);
    this.name = 'LockAcquisitionTimeoutError';
  }
}

export class RedisConnectionClosedError extends Error {
  constructor(operation: string) {
    super(`Redis connection closed during ${operation}`);
    this.name = 'RedisConnectionClosedError';
  }
}

export class LockLeaseLostError extends Error {
  constructor(lockKey: string, cause?: unknown) {
    super(`Distributed lock lease "${lockKey}" is no longer active`, {
      cause,
    });
    this.name = 'LockLeaseLostError';
  }
}

export interface ILockLeaseContext {
  readonly signal: AbortSignal;
  assertActive(): void;
}

const inactiveController = new AbortController();

export const UNFENCED_LOCK_LEASE_CONTEXT: ILockLeaseContext = Object.freeze({
  signal: inactiveController.signal,
  assertActive: () => undefined,
});

function isConnectionClosedError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  const errorCode = (error as { code?: string }).code;

  if (error.message === CONNECTION_CLOSED_ERROR_MSG) {
    return true;
  }

  if (message.includes('connection is closed')) {
    return true;
  }

  if (message.includes('connection closed')) {
    return true;
  }

  if (message.includes('redis connection closed')) {
    return true;
  }

  if (errorCode === 'ECONNREFUSED') {
    return true;
  }

  if (errorCode === 'ENOTFOUND') {
    return true;
  }

  if (errorCode === 'ETIMEDOUT') {
    return true;
  }

  return false;
}

function nowMs(): number {
  return Date.now();
}

function clampMs(value: number, min: number): number {
  if (value < min) {
    return min;
  }
  return value;
}

function jitterMs(value: number, jitterRatio: number): number {
  const ratio = clampMs(jitterRatio, 0) / 100;
  const delta = Math.floor(value * ratio);
  if (delta <= 0) {
    return value;
  }
  const sign = Math.random() < 0.5 ? -1 : 1;
  const amount = Math.floor(Math.random() * (delta + 1));
  return value + sign * amount;
}

async function waitForRedisConnection(
  redis: Redis,
  timeoutMs: number
): Promise<boolean> {
  if (!isRedisConnectionClosed(redis)) {
    return true;
  }

  if (timeoutMs <= 0) {
    return false;
  }

  return new Promise<boolean>((resolve) => {
    let done = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    let onReady: () => void = () => {};
    let onEnd: () => void = () => {};
    let onError: () => void = () => {};

    const cleanup = () => {
      redis.off('ready', onReady);
      redis.off('connect', onReady);
      redis.off('end', onEnd);
      redis.off('close', onEnd);
      redis.off('error', onError);
    };

    const finish = (value: boolean) => {
      if (done) {
        return;
      }
      done = true;

      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }

      cleanup();
      resolve(value);
    };

    onReady = () => {
      finish(true);
    };

    onEnd = () => {
      if (!isRedisConnectionClosed(redis)) {
        finish(true);
      }
    };

    onError = () => {
      if (!isRedisConnectionClosed(redis)) {
        finish(true);
      }
    };

    timer = setTimeout(() => finish(false), timeoutMs);

    redis.on('ready', onReady);
    redis.on('connect', onReady);
    redis.on('end', onEnd);
    redis.on('close', onEnd);
    redis.on('error', onError);
  });
}

async function ensureRedisConnectedOrThrow(
  redis: Redis,
  operation: string,
  timeoutMs: number
): Promise<void> {
  if (!isRedisConnectionClosed(redis)) {
    return;
  }

  const ok = await waitForRedisConnection(redis, timeoutMs);
  if (ok) {
    return;
  }

  throw new RedisConnectionClosedError(operation);
}

async function safeRelease(
  redis: Redis,
  key: string,
  token: string
): Promise<void> {
  await releaseLock(redis, key, token).catch(() => {});
}

export interface ILockLeaseGuard {
  readonly context: ILockLeaseContext;
  stop(): Promise<void>;
  assertActive(): void;
  deactivate(): void;
}

export function createLockLeaseGuard(
  redis: Redis,
  key: string,
  lockKey: string,
  token: string,
  ttlMs: number,
  options: { renewIntervalMs?: number } = {}
): ILockLeaseGuard {
  let stopped = false;
  let confirmedUntilMs = nowMs() + ttlMs;
  let lostError: LockLeaseLostError | null = null;
  let wakeTimer: ReturnType<typeof setTimeout> | null = null;
  let wakeResolve: (() => void) | null = null;
  let expiryTimer: ReturnType<typeof setTimeout> | null = null;
  const abortController = new AbortController();

  const tickEveryMs = Math.min(
    clampMs(options.renewIntervalMs ?? Math.floor(ttlMs * 0.4), 1),
    Math.max(1, ttlMs - 1)
  );

  const clearExpiryTimer = () => {
    if (expiryTimer !== null) {
      clearTimeout(expiryTimer);
      expiryTimer = null;
    }
  };

  const loseLease = (cause?: unknown): LockLeaseLostError => {
    if (lostError) {
      return lostError;
    }

    lostError = new LockLeaseLostError(lockKey, cause);
    clearExpiryTimer();
    abortController.abort(lostError);
    return lostError;
  };

  const armExpiryTimer = () => {
    clearExpiryTimer();
    const remainingMs = confirmedUntilMs - nowMs();
    if (remainingMs <= 0) {
      loseLease();
      return;
    }

    expiryTimer = setTimeout(() => {
      loseLease();
    }, remainingMs);
  };

  const assertActive = () => {
    if (!lostError && nowMs() >= confirmedUntilMs) {
      loseLease();
    }

    if (lostError) {
      throw lostError;
    }
  };

  const waitForNextTick = (): Promise<void> =>
    new Promise<void>((resolve) => {
      wakeResolve = resolve;
      wakeTimer = setTimeout(() => {
        wakeTimer = null;
        wakeResolve = null;
        resolve();
      }, tickEveryMs);
    });

  armExpiryTimer();

  const run = async (): Promise<void> => {
    while (!stopped) {
      await waitForNextTick();

      if (stopped) {
        return;
      }

      try {
        assertActive();
      } catch {
        return;
      }

      if (isRedisConnectionClosed(redis)) {
        continue;
      }

      try {
        const extended = await extendLock(redis, key, token, ttlMs);
        if (stopped) {
          return;
        }

        if (!extended) {
          loseLease();
          return;
        }

        confirmedUntilMs = nowMs() + ttlMs;
        armExpiryTimer();
      } catch (error) {
        if (nowMs() >= confirmedUntilMs) {
          loseLease(error);
          return;
        }
      }
    }
  };

  const runPromise = run();

  return {
    context: {
      signal: abortController.signal,
      assertActive,
    },
    assertActive,
    deactivate: () => {
      loseLease(new Error('Distributed lock callback completed'));
    },
    stop: async () => {
      stopped = true;
      clearExpiryTimer();

      if (wakeTimer !== null) {
        clearTimeout(wakeTimer);
        wakeTimer = null;
      }
      const resolve = wakeResolve;
      wakeResolve = null;
      resolve?.();

      await runPromise;
      clearExpiryTimer();
    },
  };
}

async function redisGetWithReconnect(
  redis: Redis,
  key: string,
  deadlineMs: number,
  retryMs: number
): Promise<string | null> {
  let attempt = 0;

  while (true) {
    const remaining = deadlineMs - nowMs();
    if (remaining <= 0) {
      return null;
    }

    const connectWait = Math.min(remaining, 5000);
    await ensureRedisConnectedOrThrow(redis, 'redis GET', connectWait);

    try {
      return await redis.get(key);
    } catch (error) {
      if (!isConnectionClosedError(error)) {
        throw error;
      }

      attempt += 1;

      const backoff = Math.min(2000, retryMs * Math.max(1, attempt));
      const sleepFor = Math.min(deadlineMs - nowMs(), jitterMs(backoff, 25));

      if (sleepFor <= 0) {
        return null;
      }

      await delay(sleepFor);
    }
  }
}

export async function withLock<T>(
  redis: Redis,
  lockKey: string,
  fn: (context: ILockLeaseContext) => Promise<T>,
  options?: {
    ttlMs?: number;
    retryMs?: number;
    maxWaitMs?: number;
    preventDuplicate?: boolean;
    duplicateTtlSeconds?: number;
  }
): Promise<T> {
  const key = `underchat:lock:${lockKey}`;
  const token = uuidv7();
  const ttlMs = options?.ttlMs ?? 20000;
  const retryMs = options?.retryMs ?? 150;
  const maxWaitMs = options?.maxWaitMs ?? ttlMs * 3;
  const preventDuplicate = options?.preventDuplicate ?? false;
  const duplicateTtlSeconds = options?.duplicateTtlSeconds ?? 300;
  const executedKey = preventDuplicate ? `underchat:executed:${lockKey}` : null;

  const startTime = nowMs();
  const deadlineMs = startTime + maxWaitMs;

  let acquired = false;
  let watchdog: ILockLeaseGuard | null = null;

  try {
    let attempt = 0;

    while (!acquired) {
      const elapsed = nowMs() - startTime;
      const remaining = maxWaitMs - elapsed;

      if (remaining <= 0) {
        throw new LockAcquisitionTimeoutError(lockKey, maxWaitMs);
      }

      const connectWait = Math.min(remaining, 5000);
      await ensureRedisConnectedOrThrow(redis, 'lock acquisition', connectWait);

      try {
        const ok = await redis.set(key, token, 'PX', ttlMs, 'NX');
        if (ok === 'OK') {
          acquired = true;
          break;
        }
      } catch (error) {
        if (!isConnectionClosedError(error)) {
          throw error;
        }
      }

      attempt += 1;

      const base = Math.min(2000, retryMs * Math.max(1, attempt));
      const sleepFor = Math.min(deadlineMs - nowMs(), jitterMs(base, 25));

      if (sleepFor <= 0) {
        throw new LockAcquisitionTimeoutError(lockKey, maxWaitMs);
      }

      await delay(sleepFor);
    }

    watchdog = createLockLeaseGuard(redis, key, lockKey, token, ttlMs);

    if (preventDuplicate && executedKey) {
      const alreadyExecuted = await redisGetWithReconnect(
        redis,
        executedKey,
        deadlineMs,
        retryMs
      );

      if (alreadyExecuted) {
        await watchdog.stop();
        watchdog.deactivate();
        await safeRelease(redis, key, token);
        return undefined as T;
      }
    }

    try {
      watchdog.assertActive();
      const result = await fn(watchdog.context);
      watchdog.assertActive();

      if (preventDuplicate && executedKey) {
        watchdog.assertActive();
        await redis.set(executedKey, '1', 'EX', duplicateTtlSeconds);
        watchdog.assertActive();
      }

      if (watchdog) {
        await watchdog.stop();
        watchdog.assertActive();
        watchdog.deactivate();
      }

      await safeRelease(redis, key, token);

      return result;
    } catch (e) {
      if (watchdog) {
        watchdog.deactivate();
        await watchdog.stop();
      }

      await safeRelease(redis, key, token);

      throw e;
    }
  } finally {
    if (watchdog) {
      await watchdog.stop();
      watchdog.deactivate();
    }
  }
}
