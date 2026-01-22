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

function startLockWatchdog(
  redis: Redis,
  key: string,
  token: string,
  ttlMs: number
): { stop: () => void } {
  let stopped = false;

  const tickEveryMs = clampMs(Math.floor(ttlMs * 0.4), 50);

  const run = async () => {
    while (!stopped) {
      await delay(tickEveryMs);

      if (stopped) {
        return;
      }

      if (isRedisConnectionClosed(redis)) {
        await waitForRedisConnection(redis, ttlMs).catch(() => {});
      }

      if (stopped) {
        return;
      }

      if (isRedisConnectionClosed(redis)) {
        continue;
      }

      await extendLock(redis, key, token, ttlMs).catch(() => {});
    }
  };

  void run();

  return {
    stop: () => {
      stopped = true;
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
  fn: () => Promise<T>,
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
  let watchdog: { stop: () => void } | null = null;

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

    if (preventDuplicate && executedKey) {
      const alreadyExecuted = await redisGetWithReconnect(
        redis,
        executedKey,
        deadlineMs,
        retryMs
      );

      if (alreadyExecuted) {
        await safeRelease(redis, key, token);
        return undefined as T;
      }
    }

    watchdog = startLockWatchdog(redis, key, token, ttlMs);

    try {
      const result = await fn();

      if (preventDuplicate && executedKey) {
        await redis
          .set(executedKey, '1', 'EX', duplicateTtlSeconds)
          .catch(() => {});
      }

      if (watchdog) {
        watchdog.stop();
      }

      await safeRelease(redis, key, token);

      return result;
    } catch (e) {
      if (watchdog) {
        watchdog.stop();
      }

      await safeRelease(redis, key, token);

      throw e;
    }
  } finally {
    if (watchdog) {
      watchdog.stop();
    }
  }
}
