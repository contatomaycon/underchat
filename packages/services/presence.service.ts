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
  private readonly ttlSeconds = 90;
  private readonly monitorIntervalMs = 30_000;
  private readonly keyPrefix = 'presence:user:';

  private readonly statusCache = new Map<string, EChatUserStatus>();
  private monitorTimer: ReturnType<typeof setInterval> | null = null;

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

  private getActiveStatuses(): EChatUserStatus[] {
    return [
      EChatUserStatus.online,
      EChatUserStatus.away,
      EChatUserStatus.busy,
      EChatUserStatus.do_not_disturb,
    ];
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
    await this.refreshPresenceKey(userId, EChatUserStatus.online);

    const newStatus = EChatUserStatus.online;
    const cachedStatus = this.statusCache.get(userId);

    const currentStatus =
      cachedStatus ?? (await this.chatUserViewer.findStatusByUserId(userId));

    if (currentStatus === newStatus) {
      this.statusCache.set(userId, newStatus);
      await this.publishUserStatus(userId, newStatus);
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
    }

    await this.publishUserStatus(userId, newStatus);
  }

  async heartbeat(userId: string): Promise<void> {
    const cachedStatus = this.statusCache.get(userId);
    const currentStatus =
      cachedStatus ?? (await this.chatUserViewer.findStatusByUserId(userId));

    if (
      currentStatus === EChatUserStatus.busy ||
      currentStatus === EChatUserStatus.do_not_disturb
    ) {
      await this.refreshPresenceKey(userId, currentStatus);
      this.statusCache.set(userId, currentStatus);
      await this.publishUserStatus(userId, currentStatus);
      return;
    }

    const newStatus = EChatUserStatus.online;
    await this.refreshPresenceKey(userId, newStatus);

    if (currentStatus === newStatus) {
      this.statusCache.set(userId, newStatus);
      await this.publishUserStatus(userId, newStatus);
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
    }

    await this.publishUserStatus(userId, newStatus);
  }

  async setUserOffline(userId: string): Promise<void> {
    const key = this.getKey(userId);
    await this.redis.del(key);

    const newStatus = EChatUserStatus.offline;
    const cachedStatus = this.statusCache.get(userId);

    const currentStatus =
      cachedStatus ?? (await this.chatUserViewer.findStatusByUserId(userId));

    if (currentStatus === newStatus) {
      this.statusCache.set(userId, newStatus);
      await this.publishUserStatus(userId, newStatus);
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
    }

    await this.publishUserStatus(userId, newStatus);
  }

  async setUserAway(userId: string): Promise<void> {
    await this.refreshPresenceKey(userId, EChatUserStatus.away);

    const newStatus = EChatUserStatus.away;
    const cachedStatus = this.statusCache.get(userId);

    const currentStatus =
      cachedStatus ?? (await this.chatUserViewer.findStatusByUserId(userId));

    if (currentStatus === newStatus) {
      this.statusCache.set(userId, newStatus);
      await this.publishUserStatus(userId, newStatus);
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
    }

    await this.publishUserStatus(userId, newStatus);
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

    const cachedStatus = this.statusCache.get(userId);
    if (cachedStatus === targetStatus) {
      return;
    }

    const currentStatus =
      cachedStatus ?? (await this.chatUserViewer.findStatusByUserId(userId));

    if (currentStatus === targetStatus) {
      this.statusCache.set(userId, targetStatus);
      await this.publishUserStatus(userId, targetStatus);
      return;
    }

    if (currentStatus === null) {
      await this.ensureChatUserRow(userId, targetStatus);
      this.statusCache.set(userId, targetStatus);
      await this.publishUserStatus(userId, targetStatus);
      return;
    }

    const updated = await this.chatUserUpdater.updateStatusIfChanged(
      userId,
      targetStatus
    );

    if (updated || currentStatus !== targetStatus) {
      this.statusCache.set(userId, targetStatus);
      await this.publishUserStatus(userId, targetStatus);
    }
  }

  private async syncActiveUsersFromRedis(): Promise<void> {
    const activeUserIds = await this.chatUserViewer.listUserIdsByStatuses(
      this.getActiveStatuses()
    );

    await Promise.all(
      activeUserIds.map(async (userId) => {
        try {
          await this.syncStatusFromRedis(userId);
        } catch (error) {
          console.error('Failed to sync presence status', { userId, error });
        }
      })
    );
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
