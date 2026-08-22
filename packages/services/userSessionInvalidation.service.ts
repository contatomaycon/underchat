import { inject, injectable } from 'tsyringe';
import Redis from 'ioredis';
import {
  createJwtCacheVersionKey,
  createJwtSessionKey,
  createUserAccessScopeCacheKey,
  createUserAttendanceRulesCacheKey,
} from '@core/common/functions/createCacheKey';
import { chatAccountCentrifugo } from '@core/common/functions/centrifugoQueue';
import { CentrifugoService } from '@core/services/centrifugo.service';
import { PresenceService } from '@core/services/presence.service';

@injectable()
export class UserSessionInvalidationService {
  constructor(
    @inject('Redis') private readonly redis: Redis,
    @inject(PresenceService)
    private readonly presenceService: PresenceService,
    @inject(CentrifugoService)
    private readonly centrifugoService: CentrifugoService
  ) {}

  async invalidateUser(accountId: string, userId: string): Promise<void> {
    const legacySessionKey = createJwtSessionKey(accountId, userId);
    const webSessionKey = createJwtSessionKey(accountId, userId, 'web');
    const mobileSessionKey = createJwtSessionKey(accountId, userId, 'mobile');
    const cacheVersionKey = createJwtCacheVersionKey(accountId, userId);
    const attendanceRulesKey = createUserAttendanceRulesCacheKey(
      accountId,
      userId
    );
    const accessScopeKey = createUserAccessScopeCacheKey(userId);

    await Promise.all([
      this.redis.del(legacySessionKey, webSessionKey, mobileSessionKey),
      this.redis.incr(cacheVersionKey),
      this.redis.del(
        attendanceRulesKey,
        accessScopeKey,
        `presence:user:${userId}`,
        `presence:account_id:${userId}`
      ),
      this.presenceService.setUserOffline(userId),
      this.notifyForceLogout(accountId, userId),
    ]);
  }

  async invalidateUsers(
    accountId: string,
    userIds: readonly string[]
  ): Promise<void> {
    const uniqueUserIds = Array.from(new Set(userIds.filter(Boolean)));

    await Promise.all(
      uniqueUserIds.map((userId) => this.invalidateUser(accountId, userId))
    );
  }

  private async notifyForceLogout(
    accountId: string,
    userId: string
  ): Promise<void> {
    try {
      await this.centrifugoService.publishSub(
        chatAccountCentrifugo(accountId),
        {
          event: 'force_logout',
          user_id: userId,
        }
      );
    } catch (error) {
      console.error('Failed to notify blocked user logout', error);
    }
  }
}
