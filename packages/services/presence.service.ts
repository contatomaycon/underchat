import { inject, injectable } from 'tsyringe';
import Redis from 'ioredis';
import { EChatUserStatus } from '@core/common/enums/EChatUserStatus';
import { ChatUserViewerRepository } from '@core/repositories/chat/ChatUserViewer.repository';
import { ChatUserUpdaterRepository } from '@core/repositories/chat/ChatUserUpdater.repository';
import { UpdateChatsUserRequest } from '@core/schema/chat/updateChatsUser/request.schema';
import { CentrifugoService } from '@core/services/centrifugo.service';
import { UserAccountViewerRepository } from '@core/repositories/user/UserAccountViewer.repository';
import { chatAccountCentrifugo } from '@core/common/functions/centrifugoQueue';

@injectable()
export class PresenceService {
  private readonly ttlSeconds = 60;
  private readonly keyPrefix = 'presence:user:';

  private readonly statusCache = new Map<string, EChatUserStatus>();

  constructor(
    @inject('Redis') private readonly redis: Redis,
    private readonly chatUserViewer: ChatUserViewerRepository,
    private readonly chatUserUpdater: ChatUserUpdaterRepository,
    private readonly centrifugoService: CentrifugoService,
    private readonly userAccountViewerRepository: UserAccountViewerRepository
  ) {}

  private getKey(userId: string): string {
    return `${this.keyPrefix}${userId}`;
  }

  private async ensureChatUserRow(
    userId: string,
    status: EChatUserStatus
  ): Promise<void> {
    const existsStatus = await this.chatUserViewer.findStatusByUserId(userId);

    if (existsStatus === null) {
      const input: UpdateChatsUserRequest = {
        status,
        notifications: true,
      };

      await this.chatUserUpdater.updateChatUser(userId, input);
    }
  }

  private async publishUserStatus(
    userId: string,
    status: EChatUserStatus
  ): Promise<void> {
    try {
      const accountId =
        await this.userAccountViewerRepository.getUserAccountId(userId);

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
      console.error('Failed to publish user presence status', error);
    }
  }

  async setUserOnline(userId: string): Promise<void> {
    const key = this.getKey(userId);
    await this.redis.setex(key, this.ttlSeconds, '1');

    const newStatus = EChatUserStatus.online;
    const cachedStatus = this.statusCache.get(userId);

    const currentStatus =
      cachedStatus ?? (await this.chatUserViewer.findStatusByUserId(userId));

    if (currentStatus === newStatus) {
      return;
    }

    if (currentStatus === null) {
      await this.ensureChatUserRow(userId, newStatus);
      this.statusCache.set(userId, newStatus);
      await this.publishUserStatus(userId, newStatus);
      return;
    }

    const updated = await this.chatUserUpdater.updateStatusIfChanged(
      userId,
      newStatus
    );

    if (updated) {
      this.statusCache.set(userId, newStatus);
      await this.publishUserStatus(userId, newStatus);
    }
  }

  async heartbeat(userId: string): Promise<void> {
    const key = this.getKey(userId);
    const exists = await this.redis.exists(key);

    if (!exists) {
      await this.redis.setex(key, this.ttlSeconds, '1');
    } else {
      await this.redis.expire(key, this.ttlSeconds);
    }

    const cachedStatus = this.statusCache.get(userId);

    if (cachedStatus === EChatUserStatus.online) {
      return;
    }

    const currentStatus =
      cachedStatus ?? (await this.chatUserViewer.findStatusByUserId(userId));

    if (
      currentStatus === EChatUserStatus.busy ||
      currentStatus === EChatUserStatus.do_not_disturb
    ) {
      this.statusCache.set(userId, currentStatus);
      return;
    }

    const newStatus = EChatUserStatus.online;

    if (currentStatus === newStatus) {
      this.statusCache.set(userId, newStatus);
      return;
    }

    if (currentStatus === null) {
      await this.ensureChatUserRow(userId, newStatus);
      this.statusCache.set(userId, newStatus);
      await this.publishUserStatus(userId, newStatus);
      return;
    }

    const updated = await this.chatUserUpdater.updateStatusIfChanged(
      userId,
      newStatus
    );

    if (updated) {
      this.statusCache.set(userId, newStatus);
      await this.publishUserStatus(userId, newStatus);
    }
  }

  async setUserOffline(userId: string): Promise<void> {
    const key = this.getKey(userId);
    await this.redis.del(key);

    const newStatus = EChatUserStatus.offline;
    const cachedStatus = this.statusCache.get(userId);

    const currentStatus =
      cachedStatus ?? (await this.chatUserViewer.findStatusByUserId(userId));

    if (currentStatus === newStatus) {
      return;
    }

    if (currentStatus === null) {
      await this.ensureChatUserRow(userId, newStatus);
      this.statusCache.set(userId, newStatus);
      await this.publishUserStatus(userId, newStatus);
      return;
    }

    const updated = await this.chatUserUpdater.updateStatusIfChanged(
      userId,
      newStatus
    );

    if (updated) {
      this.statusCache.set(userId, newStatus);
      await this.publishUserStatus(userId, newStatus);
    }
  }

  async setUserAway(userId: string): Promise<void> {
    const key = this.getKey(userId);
    const exists = await this.redis.exists(key);

    if (!exists) {
      await this.redis.setex(key, this.ttlSeconds, '1');
    } else {
      await this.redis.expire(key, this.ttlSeconds);
    }

    const newStatus = EChatUserStatus.away;
    const cachedStatus = this.statusCache.get(userId);

    const currentStatus =
      cachedStatus ?? (await this.chatUserViewer.findStatusByUserId(userId));

    if (currentStatus === newStatus) {
      return;
    }

    if (currentStatus === null) {
      await this.ensureChatUserRow(userId, newStatus);
      this.statusCache.set(userId, newStatus);
      await this.publishUserStatus(userId, newStatus);
      return;
    }

    const updated = await this.chatUserUpdater.updateStatusIfChanged(
      userId,
      newStatus
    );

    if (updated) {
      this.statusCache.set(userId, newStatus);
      await this.publishUserStatus(userId, newStatus);
    }
  }

  async isUserOnline(userId: string): Promise<boolean> {
    const key = this.getKey(userId);
    const exists = await this.redis.exists(key);

    return exists === 1;
  }

  async forceOffline(userId: string): Promise<void> {
    const key = this.getKey(userId);
    await this.redis.del(key);

    await this.setUserOffline(userId);
  }

  async syncStatusFromRedis(userId: string): Promise<void> {
    const isOnline = await this.isUserOnline(userId);
    const targetStatus = isOnline
      ? EChatUserStatus.online
      : EChatUserStatus.offline;

    const cachedStatus = this.statusCache.get(userId);
    if (cachedStatus === targetStatus) {
      return;
    }

    const currentStatus =
      cachedStatus ?? (await this.chatUserViewer.findStatusByUserId(userId));

    if (currentStatus === targetStatus) {
      this.statusCache.set(userId, targetStatus);
      return;
    }

    if (currentStatus === null) {
      await this.ensureChatUserRow(userId, targetStatus);
      this.statusCache.set(userId, targetStatus);
      return;
    }

    const updated = await this.chatUserUpdater.updateStatusIfChanged(
      userId,
      targetStatus
    );

    if (updated) {
      this.statusCache.set(userId, targetStatus);
    }
  }
}
