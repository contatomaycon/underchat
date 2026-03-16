import { singleton, inject } from 'tsyringe';
import Redis from 'ioredis';
import { CentrifugoService } from '@core/services/centrifugo.service';
import { PresenceService } from '@core/services/presence.service';
import { EChatUserStatus } from '@core/common/enums/EChatUserStatus';
import { IPresenceMessage } from '@core/common/interfaces/IPresenceMessage';
import { UserAccountViewerRepository } from '@core/repositories/user/UserAccountViewer.repository';
import { PermissionService } from '@core/services/permission.service';
import { hasChatUserStatusUpdatePermissionByPermissions } from '@core/common/functions/chatUserStatusPermission';

@singleton()
export class PresenceCentrifugoConsume {
  private isRunning = false;
  private isSubscribed = false;
  private readonly presenceChannel = 'presence:updates';
  private readonly accountIdCachePrefix = 'presence:account_id:';
  private readonly accountIdCacheTtl = 3600;
  private readonly userExistsCachePrefix = 'presence:user:exists:';
  private readonly userExistsCacheTtl = 86400;
  private readonly statusPermissionCachePrefix = 'presence:status:permission:';
  private readonly statusPermissionCacheTtl = 300;
  private readonly messageHandler = async (data: unknown) => {
    if (!this.isRunning) {
      return;
    }

    await this.handlePresenceMessage(data);
  };

  constructor(
    @inject(CentrifugoService)
    private readonly centrifugoService: CentrifugoService,
    @inject('Redis') private readonly redis: Redis,
    @inject(PresenceService) private readonly presenceService: PresenceService,
    @inject(PermissionService)
    private readonly permissionService: PermissionService,
    @inject(UserAccountViewerRepository)
    private readonly userAccountViewerRepository: UserAccountViewerRepository
  ) {}

  async start(): Promise<void> {
    if (this.isRunning) return;

    this.isRunning = true;
    if (this.isSubscribed) {
      return;
    }

    try {
      await this.centrifugoService.onMessage(
        this.presenceChannel,
        this.messageHandler
      );
      this.isSubscribed = true;
    } catch (error) {
      console.error('Failed to subscribe to presence channel', error);
      this.isRunning = false;
    }
  }

  async stop(): Promise<void> {
    this.isRunning = false;
  }

  private getAccountIdCacheKey(userId: string): string {
    return `${this.accountIdCachePrefix}${userId}`;
  }

  private getUserExistsCacheKey(userId: string): string {
    return `${this.userExistsCachePrefix}${userId}`;
  }

  private getStatusPermissionCacheKey(userId: string): string {
    return `${this.statusPermissionCachePrefix}${userId}`;
  }

  private async getCachedAccountId(userId: string): Promise<string | null> {
    const cacheKey = this.getAccountIdCacheKey(userId);
    const cached = await this.redis.get(cacheKey);

    if (cached) {
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

  private async ensureValidUser(userId: string): Promise<boolean> {
    const existsCacheKey = this.getUserExistsCacheKey(userId);
    const existsCached = await this.redis.get(existsCacheKey);

    if (existsCached === '0') {
      return false;
    }

    if (existsCached === '1') {
      return true;
    }

    const accountIdCacheKey = this.getAccountIdCacheKey(userId);
    const accountIdCached = await this.redis.get(accountIdCacheKey);

    if (accountIdCached) {
      await this.redis.set(existsCacheKey, '1', 'EX', this.userExistsCacheTtl);
      return true;
    }

    try {
      const accountId =
        await this.userAccountViewerRepository.getUserAccountId(userId);

      if (!accountId) {
        console.warn(
          `Invalid user_id in presence message: ${userId} - user does not exist or was deleted`
        );

        await this.redis.set(
          existsCacheKey,
          '0',
          'EX',
          this.userExistsCacheTtl
        );
        return false;
      }

      await this.setCachedAccountId(userId, accountId);
      await this.redis.set(existsCacheKey, '1', 'EX', this.userExistsCacheTtl);
      return true;
    } catch (error) {
      console.error('Failed to validate user', { userId, error });
      return false;
    }
  }

  private async getCachedStatusPermission(
    userId: string
  ): Promise<boolean | null> {
    const cached = await this.redis.get(
      this.getStatusPermissionCacheKey(userId)
    );

    if (cached === '1') {
      return true;
    }

    if (cached === '0') {
      return false;
    }

    return null;
  }

  private async setCachedStatusPermission(
    userId: string,
    value: boolean
  ): Promise<void> {
    await this.redis.set(
      this.getStatusPermissionCacheKey(userId),
      value ? '1' : '0',
      'EX',
      this.statusPermissionCacheTtl
    );
  }

  private async canUpdateOwnStatus(userId: string): Promise<boolean> {
    const cached = await this.getCachedStatusPermission(userId);
    if (cached !== null) {
      return cached;
    }

    try {
      const permissions =
        await this.permissionService.viewPermissionByUserId(userId);
      const canUpdate =
        hasChatUserStatusUpdatePermissionByPermissions(permissions);

      await this.setCachedStatusPermission(userId, canUpdate);
      return canUpdate;
    } catch (error) {
      console.error('Failed to validate status update permission', {
        userId,
        error,
      });
      return false;
    }
  }

  private async handlePresenceMessage(data: unknown): Promise<void> {
    try {
      if (!this.isRunning) {
        return;
      }

      if (!data || typeof data !== 'object') return;

      const message = data as IPresenceMessage;

      if (
        message.event !== 'presence_update' ||
        !message.user_id ||
        !message.status
      ) {
        return;
      }

      const isValidUser = await this.ensureValidUser(message.user_id);
      if (!isValidUser) {
        return;
      }

      const canUpdateOwnStatus = await this.canUpdateOwnStatus(message.user_id);

      const validStatuses = [
        EChatUserStatus.online,
        EChatUserStatus.away,
        EChatUserStatus.busy,
        EChatUserStatus.do_not_disturb,
        EChatUserStatus.offline,
      ];

      if (!validStatuses.includes(message.status)) {
        return;
      }

      if (message.is_heartbeat) {
        if (canUpdateOwnStatus) {
          await this.presenceService.heartbeat(message.user_id, {
            keepCurrentStatus: true,
          });
        } else {
          await this.presenceService.setUserOnline(message.user_id);
        }
      } else {
        const status = canUpdateOwnStatus
          ? message.status
          : message.status === EChatUserStatus.offline
            ? EChatUserStatus.offline
            : EChatUserStatus.online;

        switch (status) {
          case EChatUserStatus.online:
            await this.presenceService.setUserOnline(message.user_id);
            break;
          case EChatUserStatus.away:
            await this.presenceService.setUserAway(message.user_id);
            break;
          case EChatUserStatus.busy:
            await this.presenceService.setUserBusy(message.user_id);
            break;
          case EChatUserStatus.do_not_disturb:
            await this.presenceService.setUserDoNotDisturb(message.user_id);
            break;
          case EChatUserStatus.offline:
            await this.presenceService.setUserOffline(message.user_id);
            break;
        }
      }
    } catch (error) {
      console.error('Failed to handle presence message', error);
    }
  }
}
