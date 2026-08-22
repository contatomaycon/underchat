import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import { ChatService } from '@core/services/chat.service';
import { UserService } from '@core/services/user.service';
import { SectorService } from '@core/services/sector.service';
import { ChatMessageService } from '@core/services/chatMessage.service';
import { CentrifugoService } from '@core/services/centrifugo.service';
import {
  chatAccountCentrifugo,
  chatQueueAccountCentrifugo,
} from '@core/common/functions/centrifugoQueue';
import {
  TransferChatParams,
  TransferChatBody,
} from '@core/schema/chat/transferChat/request.schema';
import { IChat } from '@core/common/interfaces/IChat';
import { EMessageType } from '@core/common/enums/EMessageType';
import { EChatStatus } from '@core/common/enums/EChatStatus';
import { WorkerService } from '@core/services/worker.service';
import { ChatbotFlowRunnerService } from '@core/services/chatbotFlowRunner.service';
import { replaceMessageTags } from '@core/common/functions/replaceMessageTags';
import { ChatUserViewerRepository } from '@core/repositories/chat/ChatUserViewer.repository';
import { EChatUserStatus } from '@core/common/enums/EChatUserStatus';
import Redis from 'ioredis';
import { ETypeUserChat } from '@core/common/enums/ETypeUserChat';
import { createChatCacheKey } from '@core/common/functions/createCacheKey';
import { isChatPrimary } from '@core/common/functions/chatParticipants';
import { isMasterOrAdministratorRole } from '@core/common/functions/isMasterOrAdministratorRole';
import { hasRequiredPermission } from '@core/common/functions/hasRequiredPermission';
import { canUseChannelForTransferAndForwarding } from '@core/common/functions/transferAndForwardChannelAccess';
import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';
import { EChatPermissions } from '@core/common/enums/EPermissions/chat';
import { IJwtGroupHierarchy } from '@core/common/interfaces/IJwtGroupHierarchy';
import { PushNotificationService } from '@core/services/pushNotification.service';
import { OperatorReplyPendingRedistributionTrackerService } from '@core/services/operatorReplyPendingRedistributionTracker.service';
import { IUpsertMessageEnvelope } from '@core/common/interfaces/IUpsertMessage';
import { isChatbotStatus } from '@core/common/functions/chatStatus';
import type { OutboundWebhookRequestSource } from '@core/common/functions/outboundWebhookRequestSource';
import { v7 as uuidv7 } from 'uuid';
import { withLock } from '@core/common/functions/withLock';
import { buildChatIdentityLockKey } from '@core/common/functions/chatIdentity';
import { ChatbotTransferService } from '@core/services/chatbotTransfer.service';

type ChatbotTransferTarget = {
  chatbotId: string;
  status: EChatStatus.ura | EChatStatus.ura_output;
  chatbotTransferId: string | null;
};

@injectable()
export class TransferChatUseCase {
  constructor(
    @inject(ChatService)
    private readonly chatService: ChatService,
    @inject(UserService)
    private readonly userService: UserService,
    @inject(SectorService)
    private readonly sectorService: SectorService,
    @inject(ChatMessageService)
    private readonly chatMessageService: ChatMessageService,
    @inject(CentrifugoService)
    private readonly centrifugoService: CentrifugoService,
    @inject(WorkerService)
    private readonly workerService: WorkerService,
    @inject(ChatbotFlowRunnerService)
    private readonly chatbotFlowRunnerService: ChatbotFlowRunnerService,
    @inject(ChatUserViewerRepository)
    private readonly chatUserViewerRepository: ChatUserViewerRepository,
    @inject('Redis') private readonly redis: Redis,
    @inject(PushNotificationService)
    private readonly pushNotificationService: PushNotificationService,
    @inject(OperatorReplyPendingRedistributionTrackerService)
    private readonly operatorReplyPendingRedistributionTracker: OperatorReplyPendingRedistributionTrackerService | null = null,
    @inject(ChatbotTransferService)
    private readonly chatbotTransferService: ChatbotTransferService | null = null
  ) {}

  private async loadUserAndSector(
    body: TransferChatBody,
    accountId: string
  ): Promise<{
    userData: Awaited<ReturnType<UserService['viewUserNamePhoto']>> | null;
    sectorData: Awaited<ReturnType<SectorService['viewSectorById']>> | null;
  }> {
    const userPromise = body.user_id
      ? this.userService.viewUserNamePhoto(body.user_id)
      : Promise.resolve(null);
    const sectorPromise = body.sector_id
      ? this.sectorService.viewSectorById(body.sector_id, accountId)
      : Promise.resolve(null);

    const [userData, sectorData] = await Promise.all([
      userPromise,
      sectorPromise,
    ]);

    return { userData, sectorData };
  }

  private async resolveTargetWorker(
    t: TFunction<'translation', undefined>,
    accountId: string,
    chat: IChat,
    body: TransferChatBody
  ): Promise<IChat['worker']> {
    if (!body.worker_id) {
      return chat.worker;
    }

    const worker = await this.workerService.viewWorkerNameAndId(
      accountId,
      body.worker_id
    );

    if (!worker) {
      throw new Error(t('worker_not_found'));
    }

    return {
      id: worker.id,
      name: worker.name,
    };
  }

  private async withTargetChatIdentityGuard<T>(
    t: TFunction<'translation', undefined>,
    accountId: string,
    chat: IChat,
    targetWorker: IChat['worker'],
    operation: () => Promise<T>
  ): Promise<T> {
    if (targetWorker.id === chat.worker.id) {
      return operation();
    }

    const identity = {
      phone: chat.phone,
      remoteJid: chat.message_key?.remote_jid,
      remoteJidAlt: chat.message_key?.remote_jid_alt,
    };
    const lockKey = buildChatIdentityLockKey(
      accountId,
      targetWorker.id,
      identity
    );

    return withLock(
      this.redis,
      lockKey,
      async (lockContext) => {
        const existingTargetChat =
          await this.chatService.findOpenChatByIdentity(
            accountId,
            targetWorker.id,
            identity
          );

        lockContext.assertActive();

        if (existingTargetChat && existingTargetChat.chat_id !== chat.chat_id) {
          const sectorName = existingTargetChat.sector?.name;
          if (sectorName) {
            throw new Error(
              t('chat_already_in_service_with_sector', {
                sector: sectorName,
              })
            );
          }

          throw new Error(t('chat_already_in_service'));
        }

        const result = await operation();
        lockContext.assertActive();
        return result;
      },
      { ttlMs: 60_000, retryMs: 100, maxWaitMs: 90_000 }
    );
  }

  private validateUserAndSector(
    t: TFunction<'translation', undefined>,
    body: TransferChatBody,
    user: IChat['user'] | null | undefined,
    sector: IChat['sector'] | null | undefined
  ): void {
    if (user === undefined && sector === undefined) {
      throw new Error(t('transfer_requires_user_or_sector'));
    }

    if (body.user_id && user === undefined) {
      throw new Error(t('user_not_found'));
    }

    if (body.sector_id && sector === undefined) {
      throw new Error(t('sector_not_found'));
    }
  }

  private findChatParticipantById(
    chat: IChat,
    userId: string
  ): NonNullable<IChat['user']> | null {
    if (chat.user?.id === userId) {
      return chat.user;
    }

    const secondaryUsers = Array.isArray(chat.secondary_users)
      ? chat.secondary_users
      : [];

    const secondaryUser = secondaryUsers.find((user) => user?.id === userId);
    return secondaryUser ?? null;
  }

  private buildUserFromData(
    body: TransferChatBody,
    userData: Awaited<ReturnType<UserService['viewUserNamePhoto']>> | null,
    chat: IChat,
    currentDate: string
  ): IChat['user'] | null | undefined {
    if (!body.user_id) return undefined;

    if (!userData) return undefined;

    const existingParticipant = this.findChatParticipantById(chat, userData.id);

    return {
      id: userData.id,
      name: userData.name,
      photo: userData.photo,
      entered_at: existingParticipant?.entered_at ?? currentDate,
    };
  }

  private buildSectorFromData(
    body: TransferChatBody,
    sectorData: Awaited<ReturnType<SectorService['viewSectorById']>> | null
  ): IChat['sector'] | null | undefined {
    if (!body.sector_id) return undefined;

    if (!sectorData) return undefined;

    return {
      id: sectorData.sector_id,
      name: sectorData.name,
      color: sectorData.color,
    };
  }

  private async sendAnnotationMessage(
    t: TFunction<'translation', undefined>,
    accountId: string,
    chatId: string,
    annotation: string
  ): Promise<void> {
    const chat = await this.chatService.findChatByChatId(accountId, chatId);
    if (!chat) {
      throw new Error(t('chat_not_found'));
    }

    await this.chatMessageService.sendMessage(t, {
      chat,
      accountId,
      type: EMessageType.annotation,
      message: annotation.trim(),
      typeUser: ETypeUserChat.system,
    });
  }

  private async sendProtocolMessage(
    t: TFunction<'translation', undefined>,
    accountId: string,
    chatId: string,
    protocolText: string,
    protocolType: 'protocol_ura' | 'protocol_start' | 'protocol_transfer',
    sectorName?: string | null,
    userName?: string | null
  ): Promise<string> {
    const chat = await this.chatService.findChatByChatId(accountId, chatId);
    if (!chat) {
      throw new Error(t('chat_not_found'));
    }

    const protocol =
      (await this.chatService.getOrCreateChatProtocol(
        accountId,
        chatId,
        protocolType
      )) || this.chatService.getLatestProtocolByType(chat, protocolType);
    if (!protocol) {
      throw new Error(t('chat_transfer_failed'));
    }

    const message = replaceMessageTags({
      message: protocolText,
      chat,
      protocol,
      t,
      sectorName,
      userName,
    });

    await this.chatMessageService.sendMessage(t, {
      chat,
      accountId,
      type: EMessageType.system,
      message,
      typeUser: ETypeUserChat.system,
    });

    return protocol;
  }

  private async validateTransferTarget(
    t: TFunction<'translation', undefined>,
    workerConfigFields: Awaited<
      ReturnType<WorkerService['viewWorkerConfigFieldsByWorkerId']>
    > | null,
    body: TransferChatBody
  ): Promise<void> {
    if (workerConfigFields?.allow_attendance_only_online && body.user_id) {
      const targetUserStatus =
        await this.chatUserViewerRepository.findStatusByUserId(body.user_id);

      if (targetUserStatus !== EChatUserStatus.online) {
        throw new Error(t('user_unavailable_for_transfer'));
      }
    }
  }

  private async validateUserAccessToTargetChannel(
    t: TFunction<'translation', undefined>,
    accountId: string,
    targetWorkerId: string,
    userId?: string
  ): Promise<void> {
    if (!userId) {
      return;
    }

    const userIdsWithAccess =
      await this.userService.listUserIdsWithAccessToChannel(
        accountId,
        targetWorkerId
      );

    if (!userIdsWithAccess.includes(userId)) {
      throw new Error(t('user_not_found'));
    }
  }

  private canManageInChatLifecycle(actions: IJwtGroupHierarchy[]): boolean {
    if (!actions?.length) {
      return false;
    }

    const permissions = [
      EGeneralPermissions.full_access,
      EGeneralPermissions.full_access_group,
      EChatPermissions.manage_in_chat_lifecycle,
    ];

    return hasRequiredPermission(actions, permissions);
  }

  private canDisableSendMessageOnTransfer(
    actions: IJwtGroupHierarchy[]
  ): boolean {
    const permissions = [
      EGeneralPermissions.full_access,
      EGeneralPermissions.full_access_group,
      EChatPermissions.disable_send_message_on_transfer,
    ];

    return hasRequiredPermission(actions, permissions);
  }

  private buildUpdatedChatForTransfer(
    chat: IChat,
    worker: IChat['worker'],
    user: IChat['user'] | null | undefined,
    sector: IChat['sector'] | null | undefined,
    shouldClearUser: boolean,
    shouldClearSector: boolean,
    secondaryUsers: IChat['secondary_users'] | null
  ): IChat {
    return {
      ...chat,
      worker,
      status: EChatStatus.queue,
      user: shouldClearUser ? null : (user ?? chat.user),
      secondary_users: secondaryUsers,
      sector: shouldClearSector ? null : (sector ?? chat.sector),
      forward_to_output_chatbot: true,
      chatbot_transfer_id: null,
      chatbot_schedule_id: null,
      chatbot_webhook_id: null,
    };
  }

  private canonicalJson(value: unknown): string {
    return JSON.stringify(value ?? null, (_key, nestedValue: unknown) => {
      if (
        nestedValue === null ||
        Array.isArray(nestedValue) ||
        typeof nestedValue !== 'object'
      ) {
        return nestedValue;
      }

      return Object.fromEntries(
        Object.entries(nestedValue as Record<string, unknown>)
          .filter(([, entry]) => entry !== undefined)
          .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
      );
    });
  }

  private isHumanTransferAlreadyApplied(
    currentChat: IChat,
    intendedChat: IChat
  ): boolean {
    const currentState = {
      worker: currentChat.worker,
      status: currentChat.status,
      user: currentChat.user ?? null,
      secondary_users: currentChat.secondary_users ?? [],
      sector: currentChat.sector ?? null,
      forward_to_output_chatbot: currentChat.forward_to_output_chatbot ?? null,
      chatbot_transfer_id: currentChat.chatbot_transfer_id ?? null,
      chatbot_schedule_id: currentChat.chatbot_schedule_id ?? null,
      chatbot_webhook_id: currentChat.chatbot_webhook_id ?? null,
    };
    const intendedState = {
      worker: intendedChat.worker,
      status: intendedChat.status,
      user: intendedChat.user ?? null,
      secondary_users: intendedChat.secondary_users ?? [],
      sector: intendedChat.sector ?? null,
      forward_to_output_chatbot: intendedChat.forward_to_output_chatbot ?? null,
      chatbot_transfer_id: intendedChat.chatbot_transfer_id ?? null,
      chatbot_schedule_id: intendedChat.chatbot_schedule_id ?? null,
      chatbot_webhook_id: intendedChat.chatbot_webhook_id ?? null,
    };

    return (
      this.canonicalJson(currentState) === this.canonicalJson(intendedState)
    );
  }

  private buildHumanTransferIdempotencyKey(input: {
    chat: IChat;
    targetWorkerId: string;
    targetUserId?: string;
    targetSectorId?: string;
    keepInChat: boolean;
  }): string {
    // All concurrent retries that read the same aggregate revision must share
    // the same journal intent. The assignment/status revision advances even
    // when no endpoint is subscribed; the webhook marker is only a legacy
    // fallback. A later, genuinely new transfer can therefore emit again.
    const transferRevision =
      input.chat.meta?.assignment_event_id ??
      input.chat.meta?.status_event_id ??
      input.chat.meta?.outbound_webhook_event_ids?.at(-1) ??
      input.chat.started_at ??
      input.chat.date ??
      input.chat.chat_id;

    return [
      'chat-transfer',
      input.chat.chat_id,
      'human',
      transferRevision,
      input.targetWorkerId,
      input.targetUserId ?? 'unassigned',
      input.targetSectorId ?? 'unassigned',
      input.keepInChat ? 'keep' : 'replace',
    ].join(':');
  }

  private validateChatbotTransferTarget(
    t: TFunction<'translation', undefined>,
    body: TransferChatBody
  ): void {
    if (!body.chatbot_id) {
      return;
    }

    if (!body.worker_id) {
      throw new Error(t('channel_required'));
    }

    if (body.user_id || body.sector_id) {
      throw new Error(t('transfer_chatbot_cannot_combine_targets'));
    }
  }

  private async resolveChatbotTransferTarget(
    t: TFunction<'translation', undefined>,
    targetWorkerId: string,
    chatbotId: string
  ): Promise<ChatbotTransferTarget> {
    const workerConfig =
      await this.chatService.viewWorkerConfigForChat(targetWorkerId);

    if (workerConfig?.input_chatbot?.chatbot_id === chatbotId) {
      return {
        chatbotId,
        status: EChatStatus.ura,
        chatbotTransferId: chatbotId,
      };
    }

    if (workerConfig?.output_chatbot?.chatbot_id === chatbotId) {
      return {
        chatbotId,
        status: EChatStatus.ura_output,
        chatbotTransferId: null,
      };
    }

    throw new Error(t('chatbot_not_found'));
  }

  private buildUpdatedChatForChatbotTransfer(
    chat: IChat,
    worker: IChat['worker'],
    chatbotTarget: ChatbotTransferTarget
  ): IChat {
    return {
      ...chat,
      worker,
      status: chatbotTarget.status,
      user: null,
      secondary_users: [],
      sector: null,
      forward_to_output_chatbot: false,
      chatbot_transfer_id: chatbotTarget.chatbotTransferId,
      chatbot_schedule_id: null,
      chatbot_webhook_id: null,
    };
  }

  private async bootstrapChatbotTransfer(
    t: TFunction<'translation', undefined>,
    accountId: string,
    chat: IChat,
    chatbotId: string
  ): Promise<void> {
    const bootstrapEnvelope: IUpsertMessageEnvelope = {
      key: {
        id: `transfer_bootstrap_${chat.chat_id}_${Date.now()}`,
        remoteJid: chat.message_key?.remote_jid ?? undefined,
        remoteJidAlt: chat.message_key?.remote_jid_alt ?? undefined,
        fromMe: true,
      },
      message: {
        conversation: '',
      },
      messageTimestamp: Math.floor(Date.now() / 1000),
    };

    await this.chatbotFlowRunnerService.clearFlowCacheForChat(
      accountId,
      chat.worker.id,
      chat.chat_id
    );

    await this.chatbotFlowRunnerService.execute(
      t,
      {
        account_id: accountId,
        worker_id: chat.worker.id,
        type: EMessageType.text,
        message: bootstrapEnvelope,
        has_quoted: false,
        is_call_event: false,
      },
      chat,
      chatbotId
    );
  }

  private async executeChatbotTransfer(input: {
    t: TFunction<'translation', undefined>;
    accountId: string;
    params: TransferChatParams;
    body: TransferChatBody;
    chat: IChat;
    targetWorker: IChat['worker'];
    chatbotTarget: ChatbotTransferTarget;
    actorUserId: string;
    webhookSource: OutboundWebhookRequestSource;
  }): Promise<{ chat_id: string; status: boolean }> {
    const {
      t,
      accountId,
      params,
      body,
      chat,
      targetWorker,
      chatbotTarget,
      actorUserId,
      webhookSource,
    } = input;
    const chatbotId = body.chatbot_id;
    if (!chatbotId) {
      throw new Error(t('chatbot_not_found'));
    }

    const updatedChat = this.buildUpdatedChatForChatbotTransfer(
      chat,
      targetWorker,
      chatbotTarget
    );
    const transferRevision =
      chat.meta?.assignment_event_id ??
      chat.meta?.status_event_id ??
      chat.meta?.outbound_webhook_event_ids?.at(-1) ??
      chat.started_at ??
      chat.date;

    const saved = await this.chatService.saveChat(updatedChat, {
      allowHumanToAutomation: true,
      refresh: true,
      outboundWebhook: {
        eventTypes: [
          'chat.transferred',
          ...(isChatbotStatus(chat.status)
            ? []
            : (['chat.automation.started'] as const)),
        ],
        idempotencyKey: `chat-transfer:${chat.chat_id}:chatbot:${chatbotId}:${transferRevision}`,
        source: webhookSource,
        previousChat: chat,
        actor: { type: 'user', id: actorUserId },
        changes: {
          target_type: 'automation',
          target_chatbot_id: chatbotId,
          target_worker_id: targetWorker.id,
          previous_status: chat.status,
          status: updatedChat.status,
        },
      },
    });
    if (!saved) {
      throw new Error(t('chat_transfer_failed'));
    }

    await this.chatService.clearChatSummary(params.chat_id, accountId, {
      operationId: uuidv7(),
      enforceExpectedSummaryRevision: true,
      expectedSummaryRevision: chat.summary?.revision ?? 0,
      enforceExpectedLastMessageId: true,
      expectedLastMessageId: chat.summary?.last_message_id ?? null,
    });
    await this.invalidateTransferCache(accountId, chat, updatedChat);
    await this.operatorReplyPendingRedistributionTracker?.handleChatTransition(
      updatedChat
    );
    await this.publishChatUpdate(updatedChat, accountId, actorUserId);
    await this.bootstrapChatbotTransfer(
      t,
      accountId,
      updatedChat,
      chatbotTarget.chatbotId
    );

    if (body.annotation?.trim()) {
      await this.sendAnnotationMessage(
        t,
        accountId,
        params.chat_id,
        body.annotation
      );
    }

    return {
      chat_id: params.chat_id,
      status: true,
    };
  }

  private buildSecondaryUsersForTransfer(input: {
    chat: IChat;
    keepInChat: boolean;
    nextPrimaryUser: IChat['user'] | null;
    currentDate: string;
  }): IChat['secondary_users'] | null {
    const { chat, keepInChat, nextPrimaryUser, currentDate } = input;
    const nextPrimaryUserId = nextPrimaryUser?.id ?? null;
    const previousPrimaryUser = chat.user ?? null;
    const previousPrimaryUserId = previousPrimaryUser?.id ?? null;
    const byId = new Map<string, NonNullable<IChat['user']>>();

    const existingSecondaryUsers = Array.isArray(chat.secondary_users)
      ? chat.secondary_users
      : [];

    for (const secondaryUser of existingSecondaryUsers) {
      if (!secondaryUser?.id || secondaryUser.id === nextPrimaryUserId) {
        continue;
      }

      if (!keepInChat && secondaryUser.id === previousPrimaryUserId) {
        continue;
      }
      byId.set(secondaryUser.id, secondaryUser);
    }

    if (
      keepInChat &&
      previousPrimaryUser?.id &&
      previousPrimaryUser.id !== nextPrimaryUserId
    ) {
      const existingSecondary = byId.get(previousPrimaryUser.id);
      const enteredAt =
        previousPrimaryUser.entered_at ??
        existingSecondary?.entered_at ??
        chat.started_at ??
        currentDate;

      byId.set(previousPrimaryUser.id, {
        id: previousPrimaryUser.id,
        name: previousPrimaryUser.name ?? existingSecondary?.name ?? '',
        photo: previousPrimaryUser.photo ?? existingSecondary?.photo ?? null,
        entered_at: enteredAt,
      });
    }

    if (byId.size === 0) {
      return [];
    }

    return Array.from(byId.values());
  }

  private async buildChatWithProtocol(
    updatedChat: IChat,
    workerConfigFields: Awaited<
      ReturnType<WorkerService['viewWorkerConfigFieldsByWorkerId']>
    > | null,
    shouldSendMessageOnTransfer: boolean,
    t: TFunction<'translation', undefined>,
    accountId: string,
    chatId: string,
    user: IChat['user'] | null | undefined,
    sector: IChat['sector'] | null | undefined
  ): Promise<IChat> {
    if (!shouldSendMessageOnTransfer) {
      return updatedChat;
    }

    let protocol: string | null = null;
    let protocolText: string | null = null;

    const hasUser = !!user;
    const hasSector = !!sector;

    if (hasUser && hasSector) {
      protocolText =
        workerConfigFields?.generate_protocol_at_transfer_sector_and_user ||
        null;
    } else if (hasSector) {
      protocolText =
        workerConfigFields?.generate_protocol_at_transfer_sector || null;
    } else if (hasUser) {
      protocolText = workerConfigFields?.generate_protocol_at_transfer || null;
    }

    if (protocolText) {
      protocol = await this.sendProtocolMessage(
        t,
        accountId,
        chatId,
        protocolText,
        'protocol_transfer',
        sector?.name || null,
        user?.name || null
      );
    }

    const existingProtocols = updatedChat.protocol_transfer ?? [];
    let protocolTransfer: string[] | null = null;
    if (protocol) {
      const hasProtocol = existingProtocols.includes(protocol);
      protocolTransfer = hasProtocol
        ? existingProtocols
        : [...existingProtocols, protocol];
    }
    if (!protocol && existingProtocols.length > 0) {
      protocolTransfer = existingProtocols;
    }

    return {
      ...updatedChat,
      protocol_transfer: protocolTransfer,
    };
  }

  private async invalidateTransferCache(
    accountId: string,
    previousChat: IChat,
    updatedChat: IChat
  ): Promise<void> {
    const cacheAccountId =
      updatedChat.account?.id ?? previousChat.account?.id ?? accountId;

    if (previousChat.worker?.id && cacheAccountId) {
      const previousWorkerCacheKey = createChatCacheKey(
        cacheAccountId,
        previousChat.worker.id,
        previousChat.phone
      );
      await this.redis.del(previousWorkerCacheKey);
    }

    await this.chatService.invalidateChatCache(updatedChat);
  }

  private async publishChatUpdate(
    chatWithProtocol: IChat,
    accountId: string,
    actorUserId: string
  ): Promise<void> {
    const channelAccountId = chatWithProtocol.account?.id ?? accountId;
    const payload = {
      ...chatWithProtocol,
      notification_event: {
        type: 'chat_transfer',
        actor_user_id: actorUserId,
      },
    };

    await Promise.all([
      this.centrifugoService.publishSub(
        chatAccountCentrifugo(channelAccountId),
        payload
      ),
      this.centrifugoService.publishSub(
        chatQueueAccountCentrifugo(channelAccountId),
        payload
      ),
    ]);
  }

  private async listTransferNotificationCandidateUserIds(input: {
    accountId: string;
    targetWorkerId: string;
    targetUserId?: string;
    targetSectorId?: string;
  }): Promise<string[]> {
    if (input.targetUserId) {
      return [input.targetUserId];
    }

    if (!input.targetSectorId) {
      return this.userService.listUserIdsWithAccessToChannel(
        input.accountId,
        input.targetWorkerId
      );
    }

    const [sectorUsers, channelUserIds] = await Promise.all([
      this.sectorService.listSectorUsersForTransfer(
        input.accountId,
        input.targetSectorId
      ),
      this.userService.listUserIdsWithAccessToChannel(
        input.accountId,
        input.targetWorkerId
      ),
    ]);

    const allowedSet = new Set(channelUserIds);
    return sectorUsers
      .map((user) => user.id)
      .filter((userId) => allowedSet.has(userId));
  }

  async execute(
    t: TFunction<'translation', undefined>,
    accountId: string,
    params: TransferChatParams,
    body: TransferChatBody,
    actorUserId: string,
    permissionRoleId: string | null,
    actions: IJwtGroupHierarchy[],
    userChannels: { id: string; name: string }[] = [],
    webhookSource: OutboundWebhookRequestSource = 'manager_api'
  ): Promise<{ chat_id: string; status: boolean }> {
    const chat = await this.chatService.findChatByChatId(
      accountId,
      params.chat_id
    );

    if (!chat) {
      throw new Error(t('chat_not_found'));
    }

    const channelIds = userChannels.map((c) => c.id);

    if (userChannels.length > 0) {
      if (!chat.worker?.id || !channelIds.includes(chat.worker.id)) {
        throw new Error(t('chat_access_denied'));
      }
    }

    const canManageTransfer =
      isChatPrimary(chat, actorUserId) ||
      isMasterOrAdministratorRole(permissionRoleId) ||
      this.canManageInChatLifecycle(actions);

    if (!canManageTransfer) {
      throw new Error(t('chat_only_primary_can_transfer'));
    }

    this.validateChatbotTransferTarget(t, body);

    const requestedDisableSendMessageOnTransfer =
      body.send_message_on_transfer === false;
    const canDisableSendMessageOnTransfer =
      this.canDisableSendMessageOnTransfer(actions);
    const shouldSendMessageOnTransfer = !(
      requestedDisableSendMessageOnTransfer && canDisableSendMessageOnTransfer
    );

    const targetWorker = await this.resolveTargetWorker(
      t,
      accountId,
      chat,
      body
    );

    if (
      !canUseChannelForTransferAndForwarding(
        targetWorker.id,
        userChannels,
        actions
      )
    ) {
      throw new Error(t('chat_access_denied'));
    }

    if (body.chatbot_id) {
      if (this.chatbotTransferService) {
        const operationId = uuidv7();
        const result = await this.chatbotTransferService.transfer({
          t,
          accountId,
          chat,
          targetWorkerId: targetWorker.id,
          targetChatbotId: body.chatbot_id,
          operationId,
          eventEpochMillis: Date.now(),
          source: webhookSource,
          actor: { type: 'user', id: actorUserId },
        });

        if (!result.concurrentActivity) {
          await this.chatbotFlowRunnerService.bootstrapTransferredChatbot(
            t,
            result.chat,
            result.target.chatbotId,
            operationId,
            [chat.worker.id]
          );
        }

        if (body.annotation?.trim()) {
          await this.sendAnnotationMessage(
            t,
            accountId,
            params.chat_id,
            body.annotation
          );
        }

        return { chat_id: params.chat_id, status: true };
      }

      const chatbotTarget = await this.resolveChatbotTransferTarget(
        t,
        targetWorker.id,
        body.chatbot_id
      );

      return this.withTargetChatIdentityGuard(
        t,
        accountId,
        chat,
        targetWorker,
        () =>
          this.executeChatbotTransfer({
            t,
            accountId,
            params,
            body,
            chat,
            targetWorker,
            chatbotTarget,
            actorUserId,
            webhookSource,
          })
      );
    }

    const isChannelChanged = targetWorker.id !== chat.worker.id;

    const { userData, sectorData } = await this.loadUserAndSector(
      body,
      accountId
    );
    const currentDate = new Date().toISOString();

    const workerConfigFields =
      await this.workerService.viewWorkerConfigFieldsByWorkerId(
        targetWorker.id
      );

    let user = this.buildUserFromData(body, userData, chat, currentDate);
    let sector = this.buildSectorFromData(body, sectorData);
    const keepInChat = body.keep_in_chat === true;

    const isChannelOnlyTransfer =
      isChannelChanged && !body.user_id && !body.sector_id;
    const shouldClearUser =
      isChannelOnlyTransfer || !!(body.sector_id && !body.user_id);
    const shouldClearSector =
      isChannelOnlyTransfer || !!(body.user_id && !body.sector_id);

    if (shouldClearUser) {
      user = null;
    }

    if (shouldClearSector) {
      sector = null;
    }

    this.validateUserAndSector(t, body, user, sector);

    await this.validateUserAccessToTargetChannel(
      t,
      accountId,
      targetWorker.id,
      body.user_id
    );

    await this.validateTransferTarget(t, workerConfigFields, body);

    const nextPrimaryUser: IChat['user'] | null = shouldClearUser
      ? null
      : (user ?? chat.user ?? null);

    const secondaryUsers = this.buildSecondaryUsersForTransfer({
      chat,
      keepInChat,
      nextPrimaryUser,
      currentDate,
    });

    const updatedChat = this.buildUpdatedChatForTransfer(
      chat,
      targetWorker,
      user,
      sector,
      shouldClearUser,
      shouldClearSector,
      secondaryUsers
    );

    // A client can retry after the first response was lost. Once the exact
    // human target state is already durable, acknowledge it without appending
    // another webhook marker or repeating protocols/notifications.
    if (this.isHumanTransferAlreadyApplied(chat, updatedChat)) {
      return { chat_id: params.chat_id, status: true };
    }

    if (body.user_id && chat.user?.id && body.user_id === chat.user.id) {
      throw new Error(t('chat_cannot_transfer_to_current_primary'));
    }

    const humanTransferIdempotencyKey = this.buildHumanTransferIdempotencyKey({
      chat,
      targetWorkerId: targetWorker.id,
      targetUserId: body.user_id,
      targetSectorId: body.sector_id,
      keepInChat,
    });

    let persistedChat = updatedChat;
    let saved = false;

    await this.withTargetChatIdentityGuard(
      t,
      accountId,
      chat,
      targetWorker,
      async () => {
        if (isChatbotStatus(chat.status)) {
          const handoff = await this.chatService.transferAutomationChatToQueue({
            accountId,
            chat,
            worker: targetWorker,
            user: updatedChat.user ?? null,
            sector: updatedChat.sector ?? null,
            secondaryUsers: [],
            outboundWebhook: {
              eventTypes: [
                'chat.transferred',
                'chat.automation.finished',
                'chat.queued',
              ],
              idempotencyKey: humanTransferIdempotencyKey,
              source: webhookSource,
              previousChat: chat,
              actor: { type: 'user', id: actorUserId },
              changes: {
                target_type: body.user_id ? 'user' : 'sector',
                target_user_id: body.user_id ?? null,
                target_sector_id: body.sector_id ?? null,
                target_worker_id: targetWorker.id,
                previous_status: chat.status,
                status: EChatStatus.queue,
              },
            },
          });

          saved = Boolean(handoff.chat && handoff.applied);
          persistedChat = handoff.chat ?? updatedChat;
        } else {
          saved = await this.chatService.saveChat(updatedChat, {
            refresh: true,
            outboundWebhook: {
              eventTypes: [
                'chat.transferred',
                ...(chat.status !== EChatStatus.queue
                  ? (['chat.queued'] as const)
                  : []),
              ],
              idempotencyKey: humanTransferIdempotencyKey,
              source: webhookSource,
              previousChat: chat,
              actor: { type: 'user', id: actorUserId },
              changes: {
                target_type: body.user_id ? 'user' : 'sector',
                target_user_id: body.user_id ?? null,
                target_sector_id: body.sector_id ?? null,
                target_worker_id: targetWorker.id,
                keep_in_chat: body.keep_in_chat ?? false,
                previous_status: chat.status,
                status: updatedChat.status,
              },
            },
          });

          if (saved) {
            persistedChat =
              (await this.chatService.findChatByChatId(
                accountId,
                params.chat_id
              )) ?? updatedChat;
          }
        }
      }
    );

    if (!saved) {
      throw new Error(t('chat_transfer_failed'));
    }

    if (isChatbotStatus(chat.status)) {
      await Promise.all(
        Array.from(new Set([chat.worker.id, targetWorker.id])).map((workerId) =>
          this.chatbotFlowRunnerService.clearFlowCacheForChat(
            accountId,
            workerId,
            chat.chat_id
          )
        )
      );
    }

    await this.chatService.clearChatSummary(params.chat_id, accountId, {
      operationId: uuidv7(),
      enforceExpectedSummaryRevision: true,
      expectedSummaryRevision: chat.summary?.revision ?? 0,
      enforceExpectedLastMessageId: true,
      expectedLastMessageId: chat.summary?.last_message_id ?? null,
    });

    await this.invalidateTransferCache(accountId, chat, persistedChat);
    await this.operatorReplyPendingRedistributionTracker?.handleChatTransition(
      persistedChat
    );

    const chatWithProtocol = await this.buildChatWithProtocol(
      persistedChat,
      workerConfigFields,
      shouldSendMessageOnTransfer,
      t,
      accountId,
      params.chat_id,
      user,
      sector
    );

    await this.publishChatUpdate(chatWithProtocol, accountId, actorUserId);

    const transferNotificationCandidateUserIds =
      await this.listTransferNotificationCandidateUserIds({
        accountId,
        targetWorkerId: targetWorker.id,
        targetUserId: user?.id ?? undefined,
        targetSectorId: sector?.id ?? undefined,
      });

    await this.pushNotificationService
      .sendNotificationForChatTransfer({
        chat: chatWithProtocol,
        actorUserId,
        candidateUserIds: transferNotificationCandidateUserIds,
        targetUserName: user?.name ?? null,
        targetSectorName: sector?.name ?? null,
        targetWorkerName: targetWorker.name ?? null,
      })
      .catch(() => {});

    if (body.annotation?.trim()) {
      await this.sendAnnotationMessage(
        t,
        accountId,
        params.chat_id,
        body.annotation
      );
    }

    return {
      chat_id: params.chat_id,
      status: true,
    };
  }
}
