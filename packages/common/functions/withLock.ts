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

  return (
    error.message === CONNECTION_CLOSED_ERROR_MSG ||
    message.includes('connection is closed') ||
    message.includes('connection closed') ||
    message.includes('redis connection closed') ||
    errorCode === 'ECONNREFUSED' ||
    errorCode === 'ENOTFOUND' ||
    errorCode === 'ETIMEDOUT'
  );
}

async function waitForRedisConnection(
  redis: Redis,
  timeoutMs: number
): Promise<boolean> {
  if (!isRedisConnectionClosed(redis)) {
    return true;
  }

  const startTime = Date.now();
  const checkInterval = 100;

  return new Promise<boolean>((resolve) => {
    const checkConnection = () => {
      if (!isRedisConnectionClosed(redis)) {
        resolve(true);
        return;
      }

      const elapsed = Date.now() - startTime;
      if (elapsed >= timeoutMs) {
        resolve(false);
        return;
      }

      setTimeout(checkConnection, checkInterval);
    };

    checkConnection();
  });
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

  const startTime = Date.now();
  let interval: ReturnType<typeof setInterval> | null = null;

  const clearExtensionInterval = () => {
    if (interval !== null) {
      clearInterval(interval);
      interval = null;
    }
  };

  const startExtension = () => {
    interval = setInterval(
      () => {
        if (isRedisConnectionClosed(redis)) {
          clearExtensionInterval();
          return;
        }
        extendLock(redis, key, token, ttlMs).catch(() => {});
      },
      Math.floor(ttlMs / 2)
    );
    return interval;
  };

  const tryLock = async (): Promise<T> => {
    const elapsed = Date.now() - startTime;
    if (elapsed >= maxWaitMs) {
      throw new LockAcquisitionTimeoutError(lockKey, maxWaitMs);
    }

    if (isRedisConnectionClosed(redis)) {
      const remainingTime = maxWaitMs - elapsed;
      const waitTimeout = Math.min(remainingTime, 5000);
      const reconnected = await waitForRedisConnection(redis, waitTimeout);
      if (!reconnected) {
        throw new RedisConnectionClosedError('lock acquisition');
      }
    }

    let ok: string | null;
    try {
      ok = await redis.set(key, token, 'PX', ttlMs, 'NX');
    } catch (error) {
      if (!isConnectionClosedError(error)) {
        throw error;
      }

      const remainingTime = maxWaitMs - (Date.now() - startTime);
      if (remainingTime <= 0) {
        throw new RedisConnectionClosedError('lock acquisition');
      }

      const waitTimeout = Math.min(remainingTime, 5000);
      const reconnected = await waitForRedisConnection(redis, waitTimeout);
      if (reconnected) {
        await delay(retryMs);
        return tryLock();
      }

      throw new RedisConnectionClosedError('lock acquisition');
    }

    if (ok !== 'OK') {
      await delay(retryMs);
      return tryLock();
    }

    if (preventDuplicate && executedKey) {
      try {
        const alreadyExecuted = await redis.get(executedKey);
        if (alreadyExecuted) {
          await releaseLock(redis, key, token).catch(() => {});
          return undefined as T;
        }
      } catch (error) {
        if (!isConnectionClosedError(error)) {
          throw error;
        }

        const remainingTime = maxWaitMs - (Date.now() - startTime);
        if (remainingTime <= 0) {
          return undefined as T;
        }

        const waitTimeout = Math.min(remainingTime, 5000);
        const reconnected = await waitForRedisConnection(redis, waitTimeout);
        if (reconnected) {
          await delay(retryMs);
          return tryLock();
        }

        return undefined as T;
      }
    }

    startExtension();

    try {
      const result = await fn();

      if (preventDuplicate && executedKey) {
        await redis
          .set(executedKey, '1', 'EX', duplicateTtlSeconds)
          .catch(() => {});
      }

      await releaseLock(redis, key, token).catch(() => {});
      clearExtensionInterval();

      return result;
    } catch (e) {
      await releaseLock(redis, key, token).catch(() => {});
      clearExtensionInterval();

      throw e;
    }
  };

  try {
    return await tryLock();
  } finally {
    clearExtensionInterval();
  }
}
