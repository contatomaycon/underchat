import Redis from 'ioredis';
import { v7 as uuidv7 } from 'uuid';
import { extendLock } from './extendLock';
import { releaseLock } from './releaseLock';
import { delay } from './delay';

export class LockAcquisitionTimeoutError extends Error {
  constructor(lockKey: string, timeoutMs: number) {
    super(`Failed to acquire lock "${lockKey}" after ${timeoutMs}ms`);
    this.name = 'LockAcquisitionTimeoutError';
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

  const startTime = Date.now();

  const startExtension = () =>
    setInterval(
      () => {
        extendLock(redis, key, token, ttlMs).catch(() => {});
      },
      Math.floor(ttlMs / 2)
    );

  const tryLock = async (): Promise<T> => {
    const elapsed = Date.now() - startTime;
    if (elapsed >= maxWaitMs) {
      throw new LockAcquisitionTimeoutError(lockKey, maxWaitMs);
    }

    const ok = await redis.set(key, token, 'PX', ttlMs, 'NX');
    if (ok !== 'OK') {
      await delay(retryMs);
      return tryLock();
    }

    if (preventDuplicate && executedKey) {
      const alreadyExecuted = await redis.get(executedKey);
      if (alreadyExecuted) {
        await releaseLock(redis, key, token);
        return undefined as T;
      }
    }

    const interval = startExtension();

    try {
      const result = await fn();

      if (preventDuplicate && executedKey) {
        await redis.set(executedKey, '1', 'EX', duplicateTtlSeconds);
      }

      await releaseLock(redis, key, token);
      clearInterval(interval);

      return result;
    } catch (e) {
      await releaseLock(redis, key, token);
      clearInterval(interval);

      throw e;
    }
  };

  return tryLock();
}
