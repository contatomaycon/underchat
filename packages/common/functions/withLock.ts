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
  return (
    error instanceof Error && error.message === CONNECTION_CLOSED_ERROR_MSG
  );
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
    if (isRedisConnectionClosed(redis)) {
      throw new RedisConnectionClosedError('lock acquisition');
    }

    const elapsed = Date.now() - startTime;
    if (elapsed >= maxWaitMs) {
      throw new LockAcquisitionTimeoutError(lockKey, maxWaitMs);
    }

    let ok: string | null;
    try {
      ok = await redis.set(key, token, 'PX', ttlMs, 'NX');
    } catch (error) {
      if (isConnectionClosedError(error)) {
        throw new RedisConnectionClosedError('lock acquisition');
      }
      throw error;
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
        if (isConnectionClosedError(error)) {
          return undefined as T;
        }
        throw error;
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
