import Redis from 'ioredis';
import { v7 as uuidv7 } from 'uuid';
import { extendLock } from './extendLock';
import { releaseLock } from './releaseLock';
import { delay } from './delay';

export async function withLock<T>(
  redis: Redis,
  lockKey: string,
  fn: () => Promise<T>,
  options?: {
    ttlMs?: number;
    retryMs?: number;
    preventDuplicate?: boolean;
    duplicateTtlSeconds?: number;
  }
): Promise<T> {
  const key = `underchat:lock:${lockKey}`;
  const token = uuidv7();
  const ttlMs = options?.ttlMs ?? 20000;
  const retryMs = options?.retryMs ?? 150;
  const preventDuplicate = options?.preventDuplicate ?? false;
  const duplicateTtlSeconds = options?.duplicateTtlSeconds ?? 300;
  const executedKey = preventDuplicate ? `underchat:executed:${lockKey}` : null;

  for (;;) {
    const ok = await redis.set(key, token, 'PX', ttlMs, 'NX');

    if (ok === 'OK') {
      if (preventDuplicate && executedKey) {
        const alreadyExecuted = await redis.get(executedKey);
        if (alreadyExecuted) {
          await releaseLock(redis, key, token);
          return undefined as T;
        }
      }

      const interval = setInterval(
        () => {
          extendLock(redis, key, token, ttlMs).catch(() => {});
        },
        Math.floor(ttlMs / 2)
      );

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
    }

    await delay(retryMs);
  }
}
