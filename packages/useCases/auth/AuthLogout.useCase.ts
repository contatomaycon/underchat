import { injectable, inject } from 'tsyringe';
import Redis from 'ioredis';
import { createJwtSessionKey } from '@core/common/functions/createCacheKey';

@injectable()
export class AuthLogoutUseCase {
  constructor(@inject('Redis') private readonly redis: Redis) {}

  private async invalidateUserJwtCache(
    accountId: string,
    userId: string
  ): Promise<void> {
    const pattern = `jwtCache:${accountId}:${userId}*`;
    const stream = this.redis.scanStream({
      match: pattern,
      count: 100,
    });

    const keysToDelete: string[] = [];

    stream.on('data', (keys: string[]) => {
      keysToDelete.push(...keys);
    });

    await new Promise<void>((resolve) => {
      stream.on('end', () => {
        resolve();
      });
    });

    if (keysToDelete.length > 0) {
      await this.redis.del(...keysToDelete);
    }
  }

  async execute(accountId: string, userId: string): Promise<void> {
    const sessionKey = createJwtSessionKey(accountId, userId);
    await this.redis.del(sessionKey);
    await this.invalidateUserJwtCache(accountId, userId);
  }
}
