import { injectable, inject } from 'tsyringe';
import webPush from 'web-push';
import { PushSubscriptionListerRepository } from '@core/repositories/push/PushSubscriptionLister.repository';
import { PushSubscriptionDeleterRepository } from '@core/repositories/push/PushSubscriptionDeleter.repository';
import { UsersWithNotificationsListerRepository } from '@core/repositories/push/UsersWithNotificationsLister.repository';
import { UserSectorsListerRepository } from '@core/repositories/user/UserSectorsLister.repository';
import { UserChannelChannelsListerRepository } from '@core/repositories/user/UserChannelChannelsLister.repository';
import { IPushNotificationPayload } from '@core/common/interfaces/IPushNotificationPayload';
import { IChat } from '@core/common/interfaces/IChat';
import { IChatMessage } from '@core/common/interfaces/IChatMessage';
import { EChatStatus } from '@core/common/enums/EChatStatus';
import { extractMessageTextFromContent } from '@core/common/functions/extractMessageTextFromContent';
import { vapidEnvironment } from '@core/config/environments';
import { isChatParticipant } from '@core/common/functions/chatParticipants';

const EXPO_PUSH_API_URL = 'https://exp.host/--/api/v2/push/send';
const CHAT_NOTIFICATION_ANDROID_CHANNEL = 'underchat-messages';

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
    const subscriptions = this.dedupeSubscriptionsByEndpoint(
      await this.pushSubscriptionListerRepository.listByUserId(userId)
    );

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
      const sentOk =
        subscription.provider === 'expo'
          ? await this.sendExpoNotification(subscription.endpoint, payload)
          : await this.sendWebPushNotification(
              subscription.endpoint,
              notificationPayload,
              subscription.p256dh,
              subscription.auth
            );

      if (sentOk) {
        sent++;
      } else {
        failed++;
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
    if (message.type_user === 'operator') {
      return;
    }

    const isFromMe = message.message_key?.from_me === true;
    if (isFromMe) {
      return;
    }

    if (!this.isChatStatusEligible(chat.status)) {
      return;
    }

    const accountId = chat.account.id;
    const userIds =
      await this.usersWithNotificationsListerRepository.listUsersWithNotifications(
        accountId,
        chat.status
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
        notificationType: 'chat_message',
        chatSnapshot: this.buildChatSnapshot(chat),
      },
    };

    const eligibleUserIds = new Set<string>();

    for (const userId of userIds) {
      const canReceive = await this.canUserReceiveNotification(
        userId,
        accountId,
        chat
      );

      if (canReceive) {
        eligibleUserIds.add(userId);
      }
    }

    if (eligibleUserIds.size === 0) {
      return;
    }

    const promises = Array.from(eligibleUserIds).map((userId) =>
      this.sendNotificationToUser(userId, payload).catch(() => {})
    );

    await Promise.all(promises);
  }

  async sendNotificationForChatStatusChange(chat: IChat): Promise<void> {
    if (
      chat.status !== EChatStatus.queue &&
      chat.status !== EChatStatus.in_chat
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

    const senderName = chat.name || chat.contact?.name || 'Desconhecido';
    const statusLabel =
      chat.status === EChatStatus.queue
        ? 'Aguardando atendimento'
        : 'Em atendimento';

    const payload: IPushNotificationPayload = {
      title: senderName,
      body: statusLabel,
      icon:
        chat.photo || chat.contact?.photo || '/images/svg/avatar-default.svg',
      tag: `chat-status-${chat.chat_id}`,
      data: {
        chatId: chat.chat_id,
        notificationType: 'chat_status_change',
        chatSnapshot: this.buildChatSnapshot(chat),
      },
    };

    const eligibleUserIds = new Set<string>();

    for (const userId of userIds) {
      const canReceive = await this.canUserReceiveNotification(
        userId,
        accountId,
        chat
      );

      if (canReceive) {
        eligibleUserIds.add(userId);
      }
    }

    if (eligibleUserIds.size === 0) {
      return;
    }

    const promises = Array.from(eligibleUserIds).map((userId) =>
      this.sendNotificationToUser(userId, payload).catch(() => {})
    );

    await Promise.all(promises);
  }

  private async canUserReceiveNotification(
    userId: string,
    accountId: string,
    chat: IChat
  ): Promise<boolean> {
    if (!this.isChatStatusEligible(chat.status)) {
      return false;
    }

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

    if (
      chat.status === EChatStatus.in_chat ||
      this.isChatbotStatus(chat.status)
    ) {
      return isChatParticipant(chat, userId);
    }

    if (chat.status === EChatStatus.queue) {
      if (isChatParticipant(chat, userId)) {
        return true;
      }

      if (
        chat.user?.id ||
        (Array.isArray(chat.secondary_users) && chat.secondary_users.length > 0)
      ) {
        return false;
      }

      const userSectors =
        await this.userSectorsListerRepository.listUserSectors(
          accountId,
          userId
        );

      if (userSectors.length > 0) {
        if (!chat.sector?.id) {
          return true;
        }
        return userSectors.includes(chat.sector.id);
      }

      return !chat.sector?.id;
    }

    return false;
  }

  private isChatStatusEligible(status: EChatStatus): boolean {
    return (
      status === EChatStatus.queue ||
      status === EChatStatus.in_chat ||
      this.isChatbotStatus(status)
    );
  }

  private isChatbotStatus(status: EChatStatus): boolean {
    return (
      status === EChatStatus.ura ||
      status === EChatStatus.ura_output ||
      status === EChatStatus.ura_schedule ||
      status === EChatStatus.ura_webhook
    );
  }

  private dedupeSubscriptionsByEndpoint<
    T extends { provider: string; endpoint: string },
  >(subscriptions: T[]): T[] {
    if (subscriptions.length <= 1) {
      return subscriptions;
    }

    const deduped = new Map<string, T>();
    for (const subscription of subscriptions) {
      const key = `${subscription.provider}:${subscription.endpoint}`;
      if (!deduped.has(key)) {
        deduped.set(key, subscription);
      }
    }
    return Array.from(deduped.values());
  }

  private buildChatSnapshot(chat: IChat): Record<string, unknown> {
    return {
      chat_id: chat.chat_id,
      account: chat.account,
      worker: chat.worker,
      sector: chat.sector ?? null,
      user: chat.user ?? null,
      secondary_users: chat.secondary_users ?? [],
      contact: chat.contact ?? null,
      photo: chat.photo ?? null,
      name: chat.name ?? null,
      phone: chat.phone,
      status: chat.status,
      date: chat.date,
      summary: chat.summary ?? null,
      started_at: chat.started_at ?? null,
      closed_at: chat.closed_at ?? null,
      protocol_ura: chat.protocol_ura ?? null,
      protocol_start: chat.protocol_start ?? null,
      protocol_transfer: chat.protocol_transfer ?? null,
      label: chat.label ?? null,
      forward_to_output_chatbot: chat.forward_to_output_chatbot ?? null,
    };
  }

  private async sendWebPushNotification(
    endpoint: string,
    notificationPayload: string,
    p256dh: string | null,
    auth: string | null
  ): Promise<boolean> {
    if (!this.vapidKeys) {
      return false;
    }

    if (!p256dh || !auth) {
      return false;
    }

    try {
      await webPush.sendNotification(
        {
          endpoint,
          keys: {
            p256dh,
            auth,
          },
        },
        notificationPayload
      );
      return true;
    } catch (error: any) {
      if (error.statusCode === 410 || error.statusCode === 404) {
        await this.pushSubscriptionDeleterRepository.deleteByEndpoint(
          endpoint,
          'webpush'
        );
      }
      return false;
    }
  }

  private async sendExpoNotification(
    token: string,
    payload: IPushNotificationPayload
  ): Promise<boolean> {
    if (
      !token.startsWith('ExponentPushToken[') &&
      !token.startsWith('ExpoPushToken[')
    ) {
      return false;
    }

    try {
      const response = await fetch(EXPO_PUSH_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          to: token,
          title: payload.title,
          body: payload.body,
          sound: 'default',
          priority: 'high',
          channelId: CHAT_NOTIFICATION_ANDROID_CHANNEL,
          data: payload.data ?? {},
        }),
      });

      const body = (await response.json().catch(() => null)) as {
        data?:
          | {
              status?: 'ok' | 'error';
              details?: { error?: string };
            }
          | Array<{
              status?: 'ok' | 'error';
              details?: { error?: string };
            }>;
      } | null;

      if (!response.ok || !body?.data) {
        return false;
      }

      const tickets = Array.isArray(body.data) ? body.data : [body.data];
      const hasDeviceNotRegistered = tickets.some(
        (ticket) => ticket?.details?.error === 'DeviceNotRegistered'
      );

      if (hasDeviceNotRegistered) {
        await this.pushSubscriptionDeleterRepository.deleteByEndpoint(
          token,
          'expo'
        );
      }

      return tickets.some((ticket) => ticket?.status === 'ok');
    } catch {
      return false;
    }
  }
}
