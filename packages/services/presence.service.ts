import { inject, injectable } from 'tsyringe';
import Redis from 'ioredis';
import { EChatUserStatus } from '@core/common/enums/EChatUserStatus';
import { CentrifugoService } from '@core/services/centrifugo.service';
import { UserAccountViewerRepository } from '@core/repositories/user/UserAccountViewer.repository';
import { chatAccountCentrifugo } from '@core/common/functions/centrifugoQueue';

@injectable()
export class PresenceService {
  private readonly ttlSeconds = 90;
  private readonly accountIdCacheTtl = this.ttlSeconds * 2;
  private readonly monitorIntervalMs = 60_000;
  private readonly keyPrefix = 'presence:user:';
  private readonly accountIdCachePrefix = 'presence:account_id:';
  private readonly concurrency = 10;
  private readonly maxActiveUsersPerCycle = 1_000;

  private readonly statusCache = new Map<string, EChatUserStatus>();
  private monitorTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    @inject('Redis') private readonly redis: Redis,
    private readonly centrifugoService: CentrifugoService,
    private readonly userAccountViewerRepository: UserAccountViewerRepository
  ) {}

  private getKey(userId: string): string {
    return `${this.keyPrefix}${userId}`;
  }

  private getAccountIdCacheKey(userId: string): string {
    return `${this.accountIdCachePrefix}${userId}`;
  }

  private async getCachedAccountId(userId: string): Promise<string | null> {
    const cacheKey = this.getAccountIdCacheKey(userId);
    const cached = await this.redis.get(cacheKey);

    if (cached) {
      await this.redis.expire(cacheKey, this.accountIdCacheTtl);
      return cached;
    }

    return null;
  }

  private async setCachedAccountId(
    userId: string,
    accountId: string
  ): Promise<void> {
    const cacheKey = this.getAccountIdCacheKey(userId);
    await this.redis.set(cacheKey, accountId, 'EX', this.accountIdCacheTtl);
  }

  private isConnectionError(error: unknown): boolean {
    if (!(error instanceof Error)) {
      return false;
    }

    const message = error.message.toLowerCase();
    const cause = (error as any).cause;

    return (
      message.includes('connection terminated') ||
      message.includes('connection timeout') ||
      message.includes('connection closed') ||
      message.includes('connection ended') ||
      (cause instanceof Error &&
        (cause.message.toLowerCase().includes('connection terminated') ||
          cause.message.toLowerCase().includes('connection timeout')))
    );
  }

  private async delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async getUserAccountIdWithRetry(
    userId: string,
    maxRetries = 3
  ): Promise<string | null> {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const accountId =
          await this.userAccountViewerRepository.getUserAccountId(userId);
        return accountId;
      } catch (error) {
        const isConnectionErr = this.isConnectionError(error);

        if (!isConnectionErr || attempt === maxRetries - 1) {
          throw error;
        }

        const backoffMs = Math.min(1000 * Math.pow(2, attempt), 5000);
        await this.delay(backoffMs);
      }
    }

    return null;
  }

  private async getUserAccountIdWithCache(
    userId: string
  ): Promise<string | null> {
    const cached = await this.getCachedAccountId(userId);

    if (cached) {
      return cached;
    }

    try {
      const accountId = await this.getUserAccountIdWithRetry(userId);

      if (accountId) {
        await this.setCachedAccountId(userId, accountId);
      }

      return accountId;
    } catch (error) {
      console.error('Failed to get user account ID', { userId, error });
      return null;
    }
  }

  private async clearPresenceKey(userId: string): Promise<void> {
    const key = this.getKey(userId);
    const accountKey = this.getAccountIdCacheKey(userId);

    await this.redis.del(key, accountKey);
  }

  async isUserLoggedIn(userId: string): Promise<boolean> {
    const key = this.getKey(userId);
    const exists = await this.redis.exists(key);

    return exists === 1;
  }

  private async refreshPresenceKey(
    userId: string,
    status: EChatUserStatus
  ): Promise<void> {
    await this.redis.set(this.getKey(userId), status, 'EX', this.ttlSeconds);
  }

  private parseStatusFromCache(value: string | null): EChatUserStatus | null {
    if (!value) return null;

    if (
      value === EChatUserStatus.online ||
      value === EChatUserStatus.away ||
      value === EChatUserStatus.busy ||
      value === EChatUserStatus.do_not_disturb
    ) {
      return value;
    }

    return null;
  }

  async getStatus(userId: string): Promise<EChatUserStatus | null> {
    const cached = this.statusCache.get(userId);
    if (cached) return cached;

    const key = this.getKey(userId);
    const value = await this.redis.get(key);
    const status = this.parseStatusFromCache(value);

    if (status) {
      this.statusCache.set(userId, status);
      return status;
    }

    return null;
  }

  private async getCurrentStatus(
    userId: string
  ): Promise<EChatUserStatus | null> {
    return this.getStatus(userId);
  }

  private async publishUserStatus(
    userId: string,
    status: EChatUserStatus
  ): Promise<void> {
    try {
      const accountId = await this.getUserAccountIdWithCache(userId);

      if (!accountId) {
        return;
      }

      const channel = chatAccountCentrifugo(accountId);

      await this.centrifugoService.publishSub(channel, {
        event: 'user_presence',
        user_id: userId,
        status,
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      if (
        errorMessage.includes('Connection closed') ||
        errorMessage.includes('transport closed') ||
        errorMessage.includes('Transport closed')
      ) {
        return;
      }

      console.error('Failed to publish user presence status', error);
    }
  }

  private async persistStatus(
    userId: string,
    newStatus: EChatUserStatus,
    options: {
      touchRedis?: boolean;
      clearRedis?: boolean;
      forcePublish?: boolean;
    } = {}
  ): Promise<void> {
    const {
      touchRedis = false,
      clearRedis = false,
      forcePublish = false,
    } = options;

    const currentStatus = await this.getCurrentStatus(userId);

    if (clearRedis) {
      await this.clearPresenceKey(userId);
    } else if (touchRedis) {
      await this.refreshPresenceKey(userId, newStatus);
    }

    if (currentStatus !== newStatus) {
      this.statusCache.set(userId, newStatus);
      await this.publishUserStatus(userId, newStatus);
      return;
    }

    this.statusCache.set(userId, newStatus);
    if (forcePublish) {
      await this.publishUserStatus(userId, newStatus);
    }
  }

  async setUserOnline(userId: string): Promise<void> {
    await this.persistStatus(userId, EChatUserStatus.online, {
      touchRedis: true,
      forcePublish: true,
    });
  }

  async heartbeat(userId: string): Promise<void> {
    const currentStatus = await this.getCurrentStatus(userId);

    if (
      currentStatus === EChatUserStatus.busy ||
      currentStatus === EChatUserStatus.do_not_disturb
    ) {
      await this.persistStatus(userId, currentStatus, {
        touchRedis: true,
        forcePublish: true,
      });
      return;
    }

    await this.persistStatus(userId, EChatUserStatus.online, {
      touchRedis: true,
      forcePublish: true,
    });
  }

  async setUserOffline(userId: string): Promise<void> {
    await this.persistStatus(userId, EChatUserStatus.offline, {
      clearRedis: true,
      forcePublish: true,
    });
  }

  async setUserAway(userId: string): Promise<void> {
    await this.persistStatus(userId, EChatUserStatus.away, {
      touchRedis: true,
      forcePublish: true,
    });
  }

  async setUserBusy(userId: string): Promise<void> {
    await this.persistStatus(userId, EChatUserStatus.busy, {
      touchRedis: true,
      forcePublish: true,
    });
  }

  async setUserDoNotDisturb(userId: string): Promise<void> {
    await this.persistStatus(userId, EChatUserStatus.do_not_disturb, {
      touchRedis: true,
      forcePublish: true,
    });
  }

  async isUserOnline(userId: string): Promise<boolean> {
    const key = this.getKey(userId);
    const value = await this.redis.get(key);

    return this.parseStatusFromCache(value) !== null;
  }

  async forceOffline(userId: string): Promise<void> {
    const key = this.getKey(userId);
    await this.redis.del(key);

    await this.setUserOffline(userId);
  }

  async syncStatusFromRedis(userId: string): Promise<void> {
    const cachedValue = await this.redis.get(this.getKey(userId));
    const cachedPresence = this.parseStatusFromCache(cachedValue);
    const targetStatus = cachedPresence ?? EChatUserStatus.offline;

    await this.persistStatus(userId, targetStatus, {
      touchRedis: cachedPresence !== null,
      clearRedis: cachedPresence === null,
      forcePublish: true,
    });
  }

  private isValidUUID(uuid: string): boolean {
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    return uuidRegex.test(uuid);
  }

  private async syncActiveUsersFromRedis(): Promise<void> {
    const activeUserIds: string[] = [];
    const pattern = `${this.keyPrefix}*`;
    let cursor = '0';
    let reachedLimit = false;

    do {
      const [nextCursor, keys] = await this.redis.scan(
        cursor,
        'MATCH',
        pattern,
        'COUNT',
        100
      );

      cursor = nextCursor;

      for (const key of keys) {
        if (!key.startsWith(this.keyPrefix)) {
          continue;
        }

        if (key.includes(':exists:') || key.includes(':account_id:')) {
          continue;
        }

        const userId = key.replace(this.keyPrefix, '');
        if (userId && this.isValidUUID(userId)) {
          activeUserIds.push(userId);
        }

        if (activeUserIds.length >= this.maxActiveUsersPerCycle) {
          reachedLimit = true;
          break;
        }
      }

      if (reachedLimit) {
        break;
      }
    } while (cursor !== '0');

    if (reachedLimit) {
      console.warn(
        'Presence monitor stopped after reaching the active user limit',
        {
          limit: this.maxActiveUsersPerCycle,
          tracked: activeUserIds.length,
        }
      );
    }

    for (let i = 0; i < activeUserIds.length; i += this.concurrency) {
      const batch = activeUserIds.slice(i, i + this.concurrency);

      await Promise.allSettled(
        batch.map(async (userId) => {
          try {
            await this.syncStatusFromRedis(userId);
          } catch (error) {
            console.error('Failed to sync presence status', { userId, error });
          }
        })
      );

      if (i + this.concurrency < activeUserIds.length) {
        await this.delay(100);
      }
    }
  }

  startMonitoring(): void {
    if (this.monitorTimer) return;

    void this.syncActiveUsersFromRedis().catch((error) => {
      console.error('Failed to run initial presence sync', error);
    });

    this.monitorTimer = setInterval(() => {
      this.syncActiveUsersFromRedis().catch((error) => {
        console.error('Failed to monitor presence', error);
      });
    }, this.monitorIntervalMs);
  }

  stopMonitoring(): void {
    if (!this.monitorTimer) return;

    clearInterval(this.monitorTimer);
    this.monitorTimer = null;
  }
}
