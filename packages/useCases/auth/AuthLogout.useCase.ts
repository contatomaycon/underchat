import { injectable, inject } from 'tsyringe';
import Redis from 'ioredis';
import {
  createJwtSessionKey,
  createUserAttendanceRulesCacheKey,
} from '@core/common/functions/createCacheKey';
import { PresenceService } from '@core/services/presence.service';

@injectable()
export class AuthLogoutUseCase {
  constructor(
    @inject('Redis') private readonly redis: Redis,
    @inject(PresenceService)
    private readonly presenceService: PresenceService
  ) {}

  private async scanAndDeleteByPattern(pattern: string): Promise<void> {
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

  private async invalidateUserJwtCache(
    accountId: string,
    userId: string
  ): Promise<void> {
    const pattern = `jwtCache:${accountId}:${userId}*`;
    await this.scanAndDeleteByPattern(pattern);
  }

  private async invalidateUserAttendanceRulesCache(
    accountId: string,
    userId: string
  ): Promise<void> {
    const cacheKey = createUserAttendanceRulesCacheKey(accountId, userId);
    await this.redis.del(cacheKey);
  }

  private async invalidateUserPresenceCache(userId: string): Promise<void> {
    await this.redis.del(
      `presence:user:${userId}`,
      `presence:account_id:${userId}`
    );
  }

  async execute(accountId: string, userId: string): Promise<void> {
    const sessionKey = createJwtSessionKey(accountId, userId);
    await Promise.all([
      this.redis.del(sessionKey),
      this.invalidateUserJwtCache(accountId, userId),
      this.invalidateUserAttendanceRulesCache(accountId, userId),
    ]);

    await this.presenceService.setUserOffline(userId);
    await this.invalidateUserPresenceCache(userId);
  }
}
