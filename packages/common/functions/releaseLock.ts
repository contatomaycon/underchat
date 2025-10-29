import Redis from 'ioredis';

export async function releaseLock(
  redis: Redis,
  key: string,
  token: string
): Promise<void> {
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
