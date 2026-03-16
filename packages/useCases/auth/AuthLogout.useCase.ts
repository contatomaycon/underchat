import { injectable, inject } from 'tsyringe';
import Redis from 'ioredis';
import {
  createJwtCacheVersionKey,
  createJwtSessionKey,
  createUserAttendanceRulesCacheKey,
} from '@core/common/functions/createCacheKey';
import { PresenceService } from '@core/services/presence.service';
import type { SessionPlatform } from '@core/common/types/SessionPlatform';

@injectable()
export class AuthLogoutUseCase {
  constructor(
    @inject('Redis') private readonly redis: Redis,
    @inject(PresenceService)
    private readonly presenceService: PresenceService
  ) {}

  private async invalidateUserJwtCache(
    accountId: string,
    userId: string
  ): Promise<void> {
    const cacheVersionKey = createJwtCacheVersionKey(accountId, userId);
    await this.redis.incr(cacheVersionKey);
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

  private async hasAnyActiveSession(
    accountId: string,
    userId: string
  ): Promise<boolean> {
    const legacySessionKey = createJwtSessionKey(accountId, userId);
    const webSessionKey = createJwtSessionKey(accountId, userId, 'web');
    const mobileSessionKey = createJwtSessionKey(accountId, userId, 'mobile');

    const [legacySession, webSession, mobileSession] = await Promise.all([
      this.redis.get(legacySessionKey),
      this.redis.get(webSessionKey),
      this.redis.get(mobileSessionKey),
    ]);

    return Boolean(legacySession || webSession || mobileSession);
  }

  private async removeCurrentSession(
    accountId: string,
    userId: string,
    sessionPlatform?: SessionPlatform | null
  ): Promise<void> {
    if (!sessionPlatform) {
      const legacySessionKey = createJwtSessionKey(accountId, userId);
      await this.redis.del(legacySessionKey);
      return;
    }

    const sessionKey = createJwtSessionKey(accountId, userId, sessionPlatform);
    await this.redis.del(sessionKey);

    if (sessionPlatform === 'web') {
      const legacySessionKey = createJwtSessionKey(accountId, userId);
      await this.redis.del(legacySessionKey);
    }
  }

  async execute(
    accountId: string,
    userId: string,
    sessionPlatform?: SessionPlatform | null
  ): Promise<void> {
    await Promise.all([
      this.removeCurrentSession(accountId, userId, sessionPlatform),
      this.invalidateUserJwtCache(accountId, userId),
      this.invalidateUserAttendanceRulesCache(accountId, userId),
    ]);

    const stillHasActiveSession = await this.hasAnyActiveSession(
      accountId,
      userId
    );

    if (stillHasActiveSession) {
      return;
    }

    await this.presenceService.setUserOffline(userId);
    await this.invalidateUserPresenceCache(userId);
  }
}
