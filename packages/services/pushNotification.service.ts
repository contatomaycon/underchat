import { injectable } from 'tsyringe';
import webPush from 'web-push';
import { PushSubscriptionListerRepository } from '@core/repositories/push/PushSubscriptionLister.repository';
import { PushSubscriptionDeleterRepository } from '@core/repositories/push/PushSubscriptionDeleter.repository';
import { UsersWithNotificationsListerRepository } from '@core/repositories/push/UsersWithNotificationsLister.repository';
import { PermissionAssignmentUserViewerRepository } from '@core/repositories/permission/PermissionAssignmentUserViewer.repository';
import { UserSectorsListerRepository } from '@core/repositories/user/UserSectorsLister.repository';
import { ElasticDatabaseService } from '@core/services/elasticDatabase.service';
import { IPushNotificationPayload } from '@core/common/interfaces/IPushNotificationPayload';
import { IChat } from '@core/common/interfaces/IChat';
import { IChatMessage } from '@core/common/interfaces/IChatMessage';
import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';
import { EChatPermissions } from '@core/common/enums/EPermissions/chat';
import { EChatStatus } from '@core/common/enums/EChatStatus';
import { EElasticIndex } from '@core/common/enums/EElasticIndex';
import { extractMessageTextFromContent } from '@core/common/functions/extractMessageTextFromContent';
import { vapidEnvironment } from '@core/config/environments';

@injectable()
export class PushNotificationService {
  private vapidKeys: {
    publicKey: string;
    privateKey: string;
  } | null = null;

  constructor(
    private readonly pushSubscriptionListerRepository: PushSubscriptionListerRepository,
    private readonly pushSubscriptionDeleterRepository: PushSubscriptionDeleterRepository,
    private readonly usersWithNotificationsListerRepository: UsersWithNotificationsListerRepository,
    private readonly permissionAssignmentUserViewerRepository: PermissionAssignmentUserViewerRepository,
    private readonly userSectorsListerRepository: UserSectorsListerRepository,
    private readonly elasticDatabaseService: ElasticDatabaseService
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
    const [permissions, userSectors, chatExistsInUserList] = await Promise.all([
      this.permissionAssignmentUserViewerRepository.viewPermissionByUserId(
        userId
      ),
      this.userSectorsListerRepository.listUserSectors(accountId, userId),
      this.checkIfChatExistsInUserList(userId, accountId, chat.chat_id),
    ]);

    if (chatExistsInUserList) {
      return true;
    }

    const permissionActions = permissions.map((p) => p.action);

    const canViewOthersChats = permissionActions.some(
      (action) =>
        action === EGeneralPermissions.full_access ||
        action === EGeneralPermissions.full_access_group ||
        action === EChatPermissions.chat_group ||
        action === EChatPermissions.view_others_chats
    );

    const canListAllChatsWithoutSectorLimit = permissionActions.some(
      (action) =>
        action === EGeneralPermissions.full_access ||
        action === EGeneralPermissions.full_access_group ||
        action === EChatPermissions.chat_group ||
        action === EChatPermissions.list_all_chats_without_sector_limit
    );

    if (canListAllChatsWithoutSectorLimit || canViewOthersChats) {
      return true;
    }

    if (chat.user?.id) {
      if (chat.user.id === userId) {
        return true;
      }
      return false;
    }

    if (
      chat.status === EChatStatus.queue &&
      !chat.sector?.id &&
      !chat.user?.id
    ) {
      return true;
    }

    if (userSectors.length === 0) {
      return !chat.sector?.id;
    }

    if (!chat.sector?.id) {
      return false;
    }

    return userSectors.includes(chat.sector.id);
  }

  private async checkIfChatExistsInUserList(
    userId: string,
    accountId: string,
    chatId: string
  ): Promise<boolean> {
    const queryElastic = {
      size: 1,
      query: {
        bool: {
          must: [
            {
              nested: {
                path: 'account',
                query: {
                  term: {
                    'account.id': accountId,
                  },
                },
              },
            },
            {
              nested: {
                path: 'user',
                query: {
                  term: {
                    'user.id': userId,
                  },
                },
              },
            },
          ],
          filter: [
            {
              term: {
                chat_id: chatId,
              },
            },
            {
              terms: {
                status: [EChatStatus.queue, EChatStatus.in_chat],
              },
            },
          ],
        },
      },
    };

    const result = await this.elasticDatabaseService.select<IChat>(
      EElasticIndex.chat,
      queryElastic
    );

    const total =
      (result?.hits?.total as { value: number })?.value ??
      (result?.hits?.total as number) ??
      0;

    return total > 0;
  }
}
