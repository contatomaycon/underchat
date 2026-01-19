import Redis from 'ioredis';
import { isRedisConnectionClosed } from '@core/plugins/redis';

export async function releaseLock(
  redis: Redis,
  key: string,
  token: string
): Promise<void> {
  if (isRedisConnectionClosed(redis)) {
    return;
  }
  await redis.eval(
    `
      if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("del", KEYS[1])
      else
        return 0
      end
    `,
    1,
    key,
    token
  );
}
