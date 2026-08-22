import Redis from 'ioredis';
import { isRedisConnectionClosed } from '@core/plugins/redis';

export async function extendLock(
  redis: Redis,
  key: string,
  token: string,
  ttlMs: number
): Promise<boolean> {
  if (isRedisConnectionClosed(redis)) {
    return false;
  }
  const result = await redis.eval(
    `
      if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("pexpire", KEYS[1], ARGV[2])
      else
        return 0
      end
    `,
    1,
    key,
    token,
    String(ttlMs)
  );

  return Number(result) === 1;
}
