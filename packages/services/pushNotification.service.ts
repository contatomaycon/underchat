import { injectable, inject } from 'tsyringe';
import webPush from 'web-push';
import { PushSubscriptionListerRepository } from '@core/repositories/push/PushSubscriptionLister.repository';
import { PushSubscriptionDeleterRepository } from '@core/repositories/push/PushSubscriptionDeleter.repository';
import { UsersWithNotificationsListerRepository } from '@core/repositories/push/UsersWithNotificationsLister.repository';
import { PermissionAssignmentUserViewerRepository } from '@core/repositories/permission/PermissionAssignmentUserViewer.repository';
import { UserSectorsListerRepository } from '@core/repositories/user/UserSectorsLister.repository';
import { UserChannelChannelsListerRepository } from '@core/repositories/user/UserChannelChannelsLister.repository';
import { IPushNotificationPayload } from '@core/common/interfaces/IPushNotificationPayload';
import { IChat } from '@core/common/interfaces/IChat';
import { IChatMessage } from '@core/common/interfaces/IChatMessage';
import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';
import { EChatPermissions } from '@core/common/enums/EPermissions/chat';
import { EChatStatus } from '@core/common/enums/EChatStatus';
import { extractMessageTextFromContent } from '@core/common/functions/extractMessageTextFromContent';
import { vapidEnvironment } from '@core/config/environments';

@injectable()
export class PushNotificationService {
  private vapidKeys: {
    publicKey: string;
    privateKey: string;
  } | null = null;

  constructor(
    @inject(PushSubscriptionListerRepository)
    private readonly pushSubscriptionListerRepository: PushSubscriptionListerRepository,
    @inject(PushSubscriptionDeleterRepository)
    private readonly pushSubscriptionDeleterRepository: PushSubscriptionDeleterRepository,
    @inject(UsersWithNotificationsListerRepository)
    private readonly usersWithNotificationsListerRepository: UsersWithNotificationsListerRepository,
    @inject(PermissionAssignmentUserViewerRepository)
    private readonly permissionAssignmentUserViewerRepository: PermissionAssignmentUserViewerRepository,
    @inject(UserSectorsListerRepository)
    private readonly userSectorsListerRepository: UserSectorsListerRepository,
    @inject(UserChannelChannelsListerRepository)
    private readonly userChannelChannelsListerRepository: UserChannelChannelsListerRepository
  ) {
    this.initializeVapidKeys();
  }

  private initializeVapidKeys(): void {
    try {
      const publicKey = vapidEnvironment.vapidPublicKey;
      const privateKey = vapidEnvironment.vapidPrivateKey;
      let contactEmail = vapidEnvironment.vapidContactEmail;

      if (
        !contactEmail.startsWith('mailto:') &&
        !contactEmail.startsWith('https://')
      ) {
        contactEmail = `mailto:${contactEmail}`;
      }

      this.vapidKeys = {
        publicKey,
        privateKey,
      };

      webPush.setVapidDetails(contactEmail, publicKey, privateKey);
    } catch {
      console.warn(
        'VAPID keys não configuradas. Push notifications não funcionarão.'
      );
    }
  }

  async sendNotificationToUser(
    userId: string,
    payload: IPushNotificationPayload
  ): Promise<{ sent: number; failed: number }> {
    if (!this.vapidKeys) {
      return { sent: 0, failed: 0 };
    }

    const subscriptions =
      await this.pushSubscriptionListerRepository.listByUserId(userId);

    if (subscriptions.length === 0) {
      return { sent: 0, failed: 0 };
    }

    const notificationPayload = JSON.stringify({
      title: payload.title,
      options: {
        body: payload.body,
        icon: payload.icon,
        badge: payload.badge || payload.icon,
        tag: payload.tag,
        data: payload.data,
      },
    });
    let sent = 0;
    let failed = 0;

    const promises = subscriptions.map(async (subscription) => {
      try {
        await webPush.sendNotification(
          {
            endpoint: subscription.endpoint,
            keys: {
              p256dh: subscription.p256dh,
              auth: subscription.auth,
            },
          },
          notificationPayload
        );
        sent++;
      } catch (error: any) {
        failed++;

        if (error.statusCode === 410 || error.statusCode === 404) {
          await this.pushSubscriptionDeleterRepository.deleteByEndpoint(
            subscription.endpoint
          );
        }
      }
    });

    await Promise.all(promises);

    return { sent, failed };
  }

  getPublicKey(): string | null {
    return this.vapidKeys?.publicKey || null;
  }

  async sendNotificationForChatMessage(
    chat: IChat,
    message: IChatMessage
  ): Promise<void> {
    if (!this.vapidKeys) {
      return;
    }

    if (message.type_user === 'operator') {
      return;
    }

    const isFromMe = message.message_key?.from_me === true;
    if (isFromMe) {
      return;
    }

    if (
      chat.status !== EChatStatus.in_chat &&
      chat.status !== EChatStatus.queue
    ) {
      return;
    }

    const accountId = chat.account.id;
    const userIds =
      await this.usersWithNotificationsListerRepository.listUsersWithNotifications(
        accountId
      );

    if (userIds.length === 0) {
      return;
    }

    const messageText = message.content
      ? extractMessageTextFromContent(message.content)
      : null;
    const senderName = chat.name || chat.contact?.name || 'Desconhecido';
    const messagePreview = messageText || '[Mensagem]';

    const payload: IPushNotificationPayload = {
      title: senderName,
      body: messagePreview,
      icon:
        chat.photo || chat.contact?.photo || '/images/svg/avatar-default.svg',
      tag: `chat-${message.chat_id}`,
      data: {
        chatId: message.chat_id,
        messageId: message.message_id,
      },
    };

    const eligibleUserIds: string[] = [];

    for (const userId of userIds) {
      const canReceive = await this.canUserReceiveNotification(
        userId,
        accountId,
        chat
      );

      if (canReceive) {
        eligibleUserIds.push(userId);
      }
    }

    if (eligibleUserIds.length === 0) {
      return;
    }

    const promises = eligibleUserIds.map((userId) =>
      this.sendNotificationToUser(userId, payload).catch(() => {})
    );

    await Promise.all(promises);
  }

  private async canUserReceiveNotification(
    userId: string,
    accountId: string,
    chat: IChat
  ): Promise<boolean> {
    const userChannels =
      await this.userChannelChannelsListerRepository.listChannelsWithNamesByUserAndAccount(
        userId,
        accountId
      );

    if (userChannels.length > 0) {
      const channelIds = userChannels.map((c) => c.id);
      if (!chat.worker?.id || !channelIds.includes(chat.worker.id)) {
        return false;
      }
    }

    const permissions =
      await this.permissionAssignmentUserViewerRepository.viewPermissionByUserId(
        userId
      );

    const permissionActions = permissions.map((p) => p.action);

    const canViewOthersChats = permissionActions.some(
      (action) =>
        action === EGeneralPermissions.full_access ||
        action === EGeneralPermissions.full_access_group ||
        action === EChatPermissions.chat_group
    );
    const canListAllChatsInSector = permissionActions.some(
      (action) =>
        action === EGeneralPermissions.full_access ||
        action === EGeneralPermissions.full_access_group ||
        action === EChatPermissions.chat_group ||
        action === EChatPermissions.list_all_chats_in_sector
    );
    const canListAllChatsWithoutSectorLimit = permissionActions.some(
      (action) =>
        action === EGeneralPermissions.full_access ||
        action === EGeneralPermissions.full_access_group ||
        action === EChatPermissions.chat_group ||
        action === EChatPermissions.list_all_chats_without_sector_limit
    );

    const hasPermissionToViewAll =
      canViewOthersChats || canListAllChatsWithoutSectorLimit;

    const userSectors = await this.userSectorsListerRepository.listUserSectors(
      accountId,
      userId
    );
    const isChatInUserSectors =
      (userSectors.length > 0 &&
        chat.sector?.id &&
        userSectors.includes(chat.sector.id)) ||
      (userSectors.length === 0 && !chat.sector?.id) ||
      (canListAllChatsInSector && !chat.sector?.id);

    if (chat.status === EChatStatus.in_chat) {
      if (chat.user?.id === userId) return true;
      if (hasPermissionToViewAll) return true;
      return canListAllChatsInSector && isChatInUserSectors;
    }

    if (hasPermissionToViewAll) {
      return true;
    }

    if (chat.status === EChatStatus.queue) {
      if (chat.user?.id) {
        return chat.user.id === userId;
      }

      if (userSectors.length > 0) {
        if (!chat.sector?.id) {
          return canListAllChatsInSector;
        }
        return canListAllChatsInSector && userSectors.includes(chat.sector.id);
      }

      return !chat.sector?.id;
    }

    return false;
  }
}
