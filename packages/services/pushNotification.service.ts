import { injectable, inject } from 'tsyringe';
import webPush from 'web-push';
import { PushSubscriptionListerRepository } from '@core/repositories/push/PushSubscriptionLister.repository';
import { PushSubscriptionDeleterRepository } from '@core/repositories/push/PushSubscriptionDeleter.repository';
import {
  PushNotificationRecipient,
  UsersWithNotificationsListerRepository,
} from '@core/repositories/push/UsersWithNotificationsLister.repository';
import { UserSectorsListerRepository } from '@core/repositories/user/UserSectorsLister.repository';
import { UserChannelChannelsListerRepository } from '@core/repositories/user/UserChannelChannelsLister.repository';
import { PermissionService } from '@core/services/permission.service';
import { IPushNotificationPayload } from '@core/common/interfaces/IPushNotificationPayload';
import { IChat } from '@core/common/interfaces/IChat';
import { IChatMessage } from '@core/common/interfaces/IChatMessage';
import { EChatStatus } from '@core/common/enums/EChatStatus';
import { EMessageType } from '@core/common/enums/EMessageType';
import { EInternalChatConversationType } from '@core/common/enums/internalChat/EInternalChatConversationType';
import { EPermissionsRoles } from '@core/common/enums/EPermissions';
import { IJwtGroupHierarchy } from '@core/common/interfaces/IJwtGroupHierarchy';
import { IInternalChatMessage } from '@core/common/interfaces/internalChat/IInternalChatMessage';
import { extractMessageTextFromContent } from '@core/common/functions/extractMessageTextFromContent';
import { canReadChatByPolicy } from '@core/common/functions/canReadChatByPolicy';
import { vapidEnvironment } from '@core/config/environments';
import { PushDeliveryQueueService } from './pushDeliveryQueue.service';
import {
  MobilePushSubscriptionProvider,
  IPushDeliveryInput,
} from '@core/common/interfaces/IPushDelivery';

type ListedPushSubscription = {
  push_subscription_id?: string | null;
  user_id?: string | null;
  provider: string;
  platform?: string | null;
  endpoint: string;
  p256dh?: string | null;
  auth?: string | null;
};

type PushNotificationSendResult = {
  sent: number;
  failed: number;
  queued: number;
};

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
    private readonly userChannelChannelsListerRepository: UserChannelChannelsListerRepository,
    @inject(PermissionService)
    private readonly permissionService: PermissionService,
    @inject(PushDeliveryQueueService)
    private readonly pushDeliveryQueueService?: PushDeliveryQueueService
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
  ): Promise<PushNotificationSendResult> {
    const subscriptions = this.dedupeSubscriptionsByEndpoint(
      await this.pushSubscriptionListerRepository.listByUserId(userId)
    ) as ListedPushSubscription[];

    if (subscriptions.length === 0) {
      return { sent: 0, failed: 0, queued: 0 };
    }

    const notificationPayload = JSON.stringify({
      title: payload.title,
      options: {
        body: payload.body,
        icon: payload.icon,
        badge: payload.badge || payload.icon,
        tag: payload.tag,
        silent: payload.sound === false,
        data: payload.data,
      },
    });
    let sent = 0;
    let failed = 0;
    let queued = 0;

    const webPushSubscriptions = subscriptions.filter(
      (subscription) => subscription.provider === 'webpush'
    );
    const webPushPromises = webPushSubscriptions.map(async (subscription) => {
      const sentOk = await this.sendWebPushNotification(
        subscription.endpoint,
        notificationPayload,
        subscription.p256dh ?? null,
        subscription.auth ?? null
      );
      if (sentOk) {
        sent++;
      } else {
        failed++;
      }
    });

    await Promise.all(webPushPromises);

    const mobileDeliveries = this.selectMobileDeliveries(
      userId,
      subscriptions,
      payload
    );

    const pushDeliveryQueueService = this.pushDeliveryQueueService;
    if (!pushDeliveryQueueService) {
      failed += mobileDeliveries.length;
      return { sent, failed, queued };
    }

    await Promise.all(
      mobileDeliveries.map(async (delivery) => {
        try {
          await pushDeliveryQueueService.enqueue(delivery);
          queued++;
        } catch {
          failed++;
        }
      })
    );

    return { sent, failed, queued };
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
    const audienceUserIds = await this.resolveChatMessageAudienceUserIds(chat);

    if (audienceUserIds.length === 0) {
      return;
    }

    const recipients =
      await this.usersWithNotificationsListerRepository.listUsersWithNotifications(
        accountId,
        chat.status,
        audienceUserIds
      );

    const allowedRecipients = await this.filterRecipientsByChatAccess(
      accountId,
      chat,
      recipients
    );

    if (allowedRecipients.length === 0) {
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

    const promises = allowedRecipients.map((recipient) =>
      this.sendNotificationToUser(
        recipient.user_id,
        this.withRecipientSound(payload, recipient.notifications_sound)
      ).catch(() => {})
    );

    await Promise.all(promises);
  }

  async sendNotificationForChatStatusChange(chat: IChat): Promise<void> {
    void chat;
  }

  async sendNotificationForChatTransfer(input: {
    chat: IChat;
    actorUserId: string;
    candidateUserIds: string[];
    targetUserName?: string | null;
    targetSectorName?: string | null;
    targetWorkerName?: string | null;
  }): Promise<void> {
    const accountId = input.chat.account.id;
    const candidateUserIds = Array.from(
      new Set(
        input.candidateUserIds.filter(
          (userId) => userId && userId !== input.actorUserId
        )
      )
    );

    if (candidateUserIds.length === 0) {
      return;
    }

    const recipients =
      await this.usersWithNotificationsListerRepository.listUsersWithTransferNotifications(
        accountId,
        candidateUserIds
      );

    const allowedRecipients = await this.filterRecipientsByChatAccess(
      accountId,
      input.chat,
      recipients
    );

    if (allowedRecipients.length === 0) {
      return;
    }

    const senderName =
      input.chat.name || input.chat.contact?.name || 'Desconhecido';
    const destination = [
      input.targetUserName,
      input.targetSectorName,
      input.targetWorkerName,
    ]
      .filter((value) => !!value?.trim())
      .join(' - ');
    const body = destination
      ? `Atendimento transferido para ${destination}`
      : 'Atendimento transferido';

    const payload: IPushNotificationPayload = {
      title: senderName,
      body,
      icon:
        input.chat.photo ||
        input.chat.contact?.photo ||
        '/images/svg/avatar-default.svg',
      tag: `chat-transfer-${input.chat.chat_id}`,
      data: {
        chatId: input.chat.chat_id,
        notificationType: 'chat_transfer',
        chatSnapshot: this.buildChatSnapshot(input.chat),
        transferTarget: {
          userName: input.targetUserName ?? null,
          sectorName: input.targetSectorName ?? null,
          workerName: input.targetWorkerName ?? null,
        },
      },
    };

    const promises = allowedRecipients.map((recipient) =>
      this.sendNotificationToUser(
        recipient.user_id,
        this.withRecipientSound(payload, recipient.notifications_sound)
      ).catch(() => {})
    );

    await Promise.all(promises);
  }

  async sendNotificationForInternalChatMessage(input: {
    message: IInternalChatMessage;
    conversationType: EInternalChatConversationType;
    participantUserIds: string[];
    conversationName?: string | null;
    conversationPhoto?: string | null;
  }): Promise<void> {
    const { message, conversationType } = input;

    if (message.deleted || message.content?.type === EMessageType.system) {
      return;
    }

    const senderUserId = message.user?.id;
    const recipientUserIds = input.participantUserIds.filter(
      (userId) => userId && userId !== senderUserId
    );

    if (recipientUserIds.length === 0) {
      return;
    }

    const recipients =
      await this.usersWithNotificationsListerRepository.listInternalChatUsersWithNotifications(
        message.account_id,
        recipientUserIds,
        conversationType
      );

    if (recipients.length === 0) {
      return;
    }

    const senderName = message.user?.name || 'Chat Interno';
    const preview = this.getInternalChatMessagePreview(message);
    const title =
      conversationType === EInternalChatConversationType.group
        ? input.conversationName?.trim() || 'Grupo interno'
        : senderName;
    const body =
      conversationType === EInternalChatConversationType.group
        ? `${senderName}: ${preview}`
        : preview;

    const payload: IPushNotificationPayload = {
      title,
      body,
      icon:
        input.conversationPhoto ||
        message.user?.photo ||
        '/images/svg/avatar-default.svg',
      tag: `internal-chat-${message.conversation_id}`,
      data: {
        notificationType: 'internal_chat_message',
        internalChatConversationId: message.conversation_id,
        internalChatMessageId: message.message_id,
        internalChatConversationType: conversationType,
      },
    };

    const promises = recipients.map((recipient) =>
      this.sendNotificationToUser(
        recipient.user_id,
        this.withRecipientSound(payload, recipient.notifications_sound)
      ).catch(() => {})
    );

    await Promise.all(promises);
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

  private getInternalChatMessagePreview(message: IInternalChatMessage): string {
    const content = message.content;

    if (content.type === EMessageType.text && content.message?.trim()) {
      return content.message.trim();
    }

    if (content.type === EMessageType.image) {
      return '[Imagem]';
    }

    if (content.type === EMessageType.video) {
      return '[Vídeo]';
    }

    if (content.type === EMessageType.audio) {
      return '[Áudio]';
    }

    if (content.type === EMessageType.document) {
      return '[Documento]';
    }

    if (content.type === EMessageType.location) {
      return '[Localização]';
    }

    if (
      content.type === EMessageType.contact_card ||
      content.type === EMessageType.contacts
    ) {
      return '[Contato]';
    }

    return content.message?.trim() || '[Mensagem]';
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

  private selectMobileDeliveries(
    userId: string,
    subscriptions: ListedPushSubscription[],
    payload: IPushNotificationPayload
  ): IPushDeliveryInput[] {
    const mobileSubscriptions = subscriptions.filter((subscription) =>
      this.isMobileProvider(subscription.provider)
    );

    if (mobileSubscriptions.length === 0) {
      return [];
    }

    const byPlatform = new Map<string, ListedPushSubscription[]>();
    for (const subscription of mobileSubscriptions) {
      const platform = this.normalizeMobilePlatform(subscription.platform);
      const current = byPlatform.get(platform) ?? [];
      current.push(subscription);
      byPlatform.set(platform, current);
    }

    const deliveries: IPushDeliveryInput[] = [];
    for (const [platform, platformSubscriptions] of byPlatform.entries()) {
      const expoSubscriptions = platformSubscriptions.filter(
        (subscription) => subscription.provider === 'expo'
      );
      const fallbackExpoEndpoint = expoSubscriptions[0]?.endpoint;

      if (platform === 'android' && this.isNativeProviderAvailable('fcm')) {
        const fcmSubscriptions = platformSubscriptions.filter(
          (subscription) => subscription.provider === 'fcm'
        );

        if (fcmSubscriptions.length > 0) {
          deliveries.push(
            ...fcmSubscriptions.map((subscription) => ({
              userId,
              provider: 'fcm' as const,
              endpoint: subscription.endpoint,
              payload,
              fallbackExpoEndpoint,
            }))
          );
          continue;
        }
      }

      if (platform === 'ios' && this.isNativeProviderAvailable('apns')) {
        const apnsSubscriptions = platformSubscriptions.filter(
          (subscription) => subscription.provider === 'apns'
        );

        if (apnsSubscriptions.length > 0) {
          deliveries.push(
            ...apnsSubscriptions.map((subscription) => ({
              userId,
              provider: 'apns' as const,
              endpoint: subscription.endpoint,
              payload,
              fallbackExpoEndpoint,
            }))
          );
          continue;
        }
      }

      deliveries.push(
        ...expoSubscriptions.map((subscription) => ({
          userId,
          provider: 'expo' as const,
          endpoint: subscription.endpoint,
          payload,
        }))
      );
    }

    return deliveries;
  }

  private isMobileProvider(
    provider: string
  ): provider is MobilePushSubscriptionProvider {
    return provider === 'expo' || provider === 'fcm' || provider === 'apns';
  }

  private normalizeMobilePlatform(platform?: string | null): string {
    if (platform === 'ios' || platform === 'android') {
      return platform;
    }

    return 'unknown';
  }

  private isNativeProviderAvailable(
    provider: MobilePushSubscriptionProvider
  ): boolean {
    return (
      this.pushDeliveryQueueService?.isProviderConfigured(provider) === true
    );
  }

  private withRecipientSound(
    payload: IPushNotificationPayload,
    notificationsSound: boolean
  ): IPushNotificationPayload {
    return {
      ...payload,
      sound: notificationsSound,
    };
  }

  private async filterRecipientsByChatAccess(
    accountId: string,
    chat: IChat,
    recipients: PushNotificationRecipient[]
  ): Promise<PushNotificationRecipient[]> {
    if (recipients.length === 0) {
      return [];
    }

    const checks = await Promise.all(
      recipients.map(async (recipient) => {
        const canRead = await this.canUserReadChat(
          recipient.user_id,
          accountId,
          chat
        ).catch(() => false);

        return canRead ? recipient : null;
      })
    );

    return checks.filter(
      (recipient): recipient is PushNotificationRecipient => !!recipient
    );
  }

  private async canUserReadChat(
    userId: string,
    accountId: string,
    chat: IChat
  ): Promise<boolean> {
    const [permissions, userChannels, userSectors] = await Promise.all([
      this.permissionService.viewPermissionByUserId(userId),
      this.userChannelChannelsListerRepository.listChannelsWithNamesByUserAndAccount(
        userId,
        accountId
      ),
      this.userSectorsListerRepository.listUserSectors(accountId, userId),
    ]);

    return canReadChatByPolicy({
      chat,
      userId,
      actions: this.buildPermissionActions(permissions),
      userSectors,
      userChannels,
    });
  }

  private buildPermissionActions(permissions: string[]): IJwtGroupHierarchy[] {
    return permissions.map((permission) => ({
      account_id: '',
      permission_role_id: '',
      role_name: '',
      module_name: '',
      action_name: permission as EPermissionsRoles,
    }));
  }

  private normalizeUserId(value: unknown): string | null {
    if (typeof value === 'string') {
      const normalized = value.trim();
      return normalized.length > 0 ? normalized : null;
    }

    if (typeof value === 'number' && Number.isFinite(value)) {
      return String(value);
    }

    return null;
  }

  private getPrimaryUserId(chat: IChat): string | null {
    return this.normalizeUserId(chat.user?.id);
  }

  private getParticipantUserIds(chat: IChat): string[] {
    const userIds = new Set<string>();
    const primaryUserId = this.getPrimaryUserId(chat);

    if (primaryUserId) {
      userIds.add(primaryUserId);
    }

    for (const secondaryUser of chat.secondary_users ?? []) {
      const secondaryUserId = this.normalizeUserId(secondaryUser?.id);
      if (secondaryUserId) {
        userIds.add(secondaryUserId);
      }
    }

    return Array.from(userIds);
  }

  private async filterUserIdsWithChannelAccess(
    accountId: string,
    channelId: string | undefined,
    userIds: string[]
  ): Promise<string[]> {
    if (userIds.length === 0) {
      return [];
    }

    if (!channelId) {
      return Array.from(new Set(userIds));
    }

    const allowedUserIds =
      await this.userChannelChannelsListerRepository.listUserIdsWithAccessToChannel(
        accountId,
        channelId
      );

    if (allowedUserIds.length === 0) {
      return [];
    }

    const allowedSet = new Set(allowedUserIds);
    return Array.from(new Set(userIds)).filter((userId) =>
      allowedSet.has(userId)
    );
  }

  private async listSectorUserIdsWithChannelAccess(
    accountId: string,
    sectorId: string,
    channelId: string | undefined
  ): Promise<string[]> {
    const sectorUserIds =
      await this.userSectorsListerRepository.listUserIdsBySector(
        accountId,
        sectorId
      );

    return this.filterUserIdsWithChannelAccess(
      accountId,
      channelId,
      sectorUserIds
    );
  }

  private async listChannelAccessUserIds(
    accountId: string,
    channelId: string | undefined
  ): Promise<string[]> {
    if (!channelId) {
      return [];
    }

    return this.userChannelChannelsListerRepository.listUserIdsWithAccessToChannel(
      accountId,
      channelId
    );
  }

  private async resolveChatMessageAudienceUserIds(
    chat: IChat
  ): Promise<string[]> {
    const accountId = chat.account.id;
    const channelId = chat.worker?.id;

    if (chat.status === EChatStatus.in_chat) {
      return this.getParticipantUserIds(chat);
    }

    if (chat.status === EChatStatus.queue) {
      const primaryUserId = this.getPrimaryUserId(chat);
      if (primaryUserId) {
        return [primaryUserId];
      }

      if (chat.sector?.id) {
        return this.listSectorUserIdsWithChannelAccess(
          accountId,
          chat.sector.id,
          channelId
        );
      }

      return this.listChannelAccessUserIds(accountId, channelId);
    }

    if (this.isChatbotStatus(chat.status)) {
      const participantUserIds = this.getParticipantUserIds(chat);
      if (participantUserIds.length > 0) {
        return participantUserIds;
      }

      if (chat.sector?.id) {
        return this.listSectorUserIdsWithChannelAccess(
          accountId,
          chat.sector.id,
          channelId
        );
      }

      return this.listChannelAccessUserIds(accountId, channelId);
    }

    return [];
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
}
