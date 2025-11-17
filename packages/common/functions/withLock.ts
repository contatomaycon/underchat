import Redis from 'ioredis';
import { v7 as uuidv7 } from 'uuid';
import { extendLock } from './extendLock';
import { releaseLock } from './releaseLock';
import { delay } from './delay';

export async function withLock<T>(
  redis: Redis,
  lockId: string,
  fn: () => Promise<T>
): Promise<T> {
  const key = `underchat:lock:jid:${lockId}`;
  const token = uuidv7();
  const ttlMs = 20000;
  const retryMs = 150;

  for (;;) {
    const ok = await redis.set(key, token, 'PX', ttlMs, 'NX');

    if (ok === 'OK') {
      const interval = setInterval(
        () => {
          extendLock(redis, key, token, ttlMs).catch(() => {});
        },
        Math.floor(ttlMs / 2)
      );

      try {
        const result = await fn();

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
