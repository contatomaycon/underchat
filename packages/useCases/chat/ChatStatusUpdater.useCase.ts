import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import {
  UpdateChatStatusBody,
  UpdateChatStatusParams,
} from '@core/schema/chat/updateChatStatus/request.schema';
import { ChatService } from '@core/services/chat.service';
import { CentrifugoService } from '@core/services/centrifugo.service';
import {
  chatAccountCentrifugo,
  chatQueueAccountCentrifugo,
} from '@core/common/functions/centrifugoQueue';
import { IJwtGroupHierarchy } from '@core/common/interfaces/IJwtGroupHierarchy';
import { hasRequiredPermission } from '@core/common/functions/hasRequiredPermission';
import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';
import { EChatPermissions } from '@core/common/enums/EPermissions/chat';
import { IChat } from '@core/common/interfaces/IChat';
import { EChatStatus } from '@core/common/enums/EChatStatus';
import { UserService } from '@core/services/user.service';
import { WorkerService } from '@core/services/worker.service';
import { WorkerConfigService } from '@core/services/workerConfig.service';
import { ChatMessageService } from '@core/services/chatMessage.service';
import { EMessageType } from '@core/common/enums/EMessageType';
import { hasProtocolTag } from '@core/common/functions/hasProtocolTag';
import { replaceMessageTags } from '@core/common/functions/replaceMessageTags';
import { EChatUserStatus } from '@core/common/enums/EChatUserStatus';
import { ETypeUserChat } from '@core/common/enums/ETypeUserChat';
import { PresenceService } from '@core/services/presence.service';
import { ChatbotFlowRunnerService } from '@core/services/chatbotFlowRunner.service';
import { IUpsertMessageEnvelope } from '@core/common/interfaces/IUpsertMessage';
import {
  isChatParticipant,
  isChatPrimary,
} from '@core/common/functions/chatParticipants';
import { isMasterOrAdministratorRole } from '@core/common/functions/isMasterOrAdministratorRole';
import { PushNotificationService } from '@core/services/pushNotification.service';
import { ChatClosureCommentCreatorRepository } from '@core/repositories/chat/ChatClosureCommentCreator.repository';

interface IClosedStatusProtocolResult {
  protocol: string | null;
  persisted: boolean;
}

@injectable()
export class ChatStatusUpdaterUseCase {
  constructor(
    @inject(ChatService)
    private readonly chatService: ChatService,
    @inject(CentrifugoService)
    private readonly centrifugoService: CentrifugoService,
    @inject(UserService)
    private readonly userService: UserService,
    @inject(WorkerService)
    private readonly workerService: WorkerService,
    @inject(WorkerConfigService)
    private readonly workerConfigService: WorkerConfigService,
    @inject(ChatMessageService)
    private readonly chatMessageService: ChatMessageService,
    @inject(PresenceService)
    private readonly presenceService: PresenceService,
    @inject(ChatbotFlowRunnerService)
    private readonly chatbotFlowRunnerService: ChatbotFlowRunnerService,
    @inject(PushNotificationService)
    private readonly pushNotificationService: PushNotificationService,
    @inject(ChatClosureCommentCreatorRepository)
    private readonly chatClosureCommentCreatorRepository: ChatClosureCommentCreatorRepository
  ) {}

  private async sendProtocolMessage(
    t: TFunction<'translation', undefined>,
    accountId: string,
    chatId: string,
    protocolText: string,
    protocolType: 'protocol_ura' | 'protocol_start' | 'protocol_transfer'
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
      throw new Error(t('chat_status_update_failed'));
    }

    const message = replaceMessageTags({
      message: protocolText,
      chat,
      protocol,
      t,
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

  private canViewOthersChats(actions: IJwtGroupHierarchy[]): boolean {
    const permissions = [
      EGeneralPermissions.full_access,
      EGeneralPermissions.full_access_group,
      EChatPermissions.chat_group,
    ];

    return hasRequiredPermission(actions, permissions);
  }

  private canViewChatsInSector(actions: IJwtGroupHierarchy[]): boolean {
    const permissions = [
      EGeneralPermissions.full_access,
      EGeneralPermissions.full_access_group,
      EChatPermissions.chat_group,
      EChatPermissions.list_all_chats_in_sector,
    ];

    return hasRequiredPermission(actions, permissions);
  }

  private canListAllChatsWithoutSectorLimit(
    actions: IJwtGroupHierarchy[]
  ): boolean {
    const permissions = [
      EGeneralPermissions.full_access,
      EGeneralPermissions.full_access_group,
      EChatPermissions.chat_group,
      EChatPermissions.list_all_chats_without_sector_limit,
    ];

    return hasRequiredPermission(actions, permissions);
  }

  private async handleInChatStatus(
    t: TFunction<'translation', undefined>,
    accountId: string,
    chatId: string,
    chat: IChat
  ): Promise<string | null> {
    const workerConfigFields =
      await this.workerService.viewWorkerConfigFieldsByWorkerId(chat.worker.id);

    if (workerConfigFields?.generate_protocol_at_start) {
      return this.sendProtocolMessage(
        t,
        accountId,
        chatId,
        workerConfigFields.generate_protocol_at_start,
        'protocol_start'
      );
    }

    return null;
  }

  private async handleClosedStatus(
    t: TFunction<'translation', undefined>,
    accountId: string,
    chatId: string,
    chat: IChat
  ): Promise<IClosedStatusProtocolResult> {
    const workerConfigFields =
      await this.workerService.viewWorkerConfigFieldsByWorkerId(chat.worker.id);

    if (!workerConfigFields?.send_message_on_finish_attendance) {
      return {
        protocol: null,
        persisted: false,
      };
    }

    const chatData = await this.chatService.findChatByChatId(accountId, chatId);
    if (!chatData) {
      return {
        protocol: null,
        persisted: false,
      };
    }

    const templateMessage =
      workerConfigFields.send_message_on_finish_attendance;
    let generatedProtocol: string | null = null;
    let protocolPersisted = false;

    if (hasProtocolTag(templateMessage)) {
      generatedProtocol =
        (await this.chatService.getOrCreateChatProtocol(
          accountId,
          chatId,
          'protocol_start'
        )) ||
        this.chatService.getLatestProtocolByType(chatData, 'protocol_start');
      protocolPersisted = generatedProtocol !== null;
    }

    const message = replaceMessageTags({
      message: templateMessage,
      chat: chatData,
      t,
      protocol: generatedProtocol,
    });

    await this.chatMessageService.sendMessage(t, {
      chat: chatData,
      accountId,
      type: EMessageType.text,
      message,
      typeUser: ETypeUserChat.system,
    });

    return {
      protocol: generatedProtocol,
      persisted: protocolPersisted,
    };
  }

  private normalizeClosureComment(comment?: string): string | null {
    if (typeof comment !== 'string') {
      return null;
    }

    const normalized = comment.trim();
    if (!normalized) {
      return null;
    }

    return normalized;
  }

  private async persistClosureComment(data: {
    t: TFunction<'translation', undefined>;
    accountId: string;
    chatId: string;
    userId: string;
    comment: string;
    closedAt: string;
  }): Promise<void> {
    const chatData = await this.chatService.findChatByChatId(
      data.accountId,
      data.chatId
    );
    if (!chatData) {
      throw new Error(data.t('chat_not_found'));
    }

    await this.chatClosureCommentCreatorRepository.create({
      accountId: data.accountId,
      chatId: data.chatId,
      userId: data.userId,
      comment: data.comment,
      closedAt: data.closedAt,
    });

    await this.chatMessageService.sendMessage(data.t, {
      chat: chatData,
      accountId: data.accountId,
      type: EMessageType.annotation,
      message: data.comment,
      typeUser: ETypeUserChat.system,
      annotationSubtype: 'closure',
    });
  }

  private async handleUraOutputStatus(
    t: TFunction<'translation', undefined>,
    accountId: string,
    chat: IChat
  ): Promise<boolean> {
    if (chat.forward_to_output_chatbot === false) {
      return false;
    }

    const chatbotConfig = await this.workerConfigService.viewChatbots(
      chat.worker.id
    );

    if (!chatbotConfig.enabled || !chatbotConfig.output_chatbot_id) {
      return false;
    }

    const chatData = await this.chatService.findChatByChatId(
      accountId,
      chat.chat_id
    );
    if (!chatData) {
      return false;
    }

    return true;
  }

  private async validatePhoneNotInActiveChat(
    t: TFunction<'translation', undefined>,
    accountId: string,
    workerId: string,
    phone: string,
    currentChatId: string
  ): Promise<void> {
    const existingChat = await this.chatService.findChatByPhone(
      accountId,
      workerId,
      phone
    );

    if (existingChat && existingChat.chat_id !== currentChatId) {
      const sectorName = existingChat.sector?.name;
      if (sectorName) {
        throw new Error(
          t('chat_already_in_service_with_sector', { sector: sectorName })
        );
      }

      throw new Error(t('chat_already_in_service'));
    }
  }

  private async validateInChatAttendance(
    t: TFunction<'translation', undefined>,
    accountId: string,
    workerId: string,
    userId: string
  ): Promise<void> {
    const workerConfig =
      await this.workerService.viewWorkerConfigFieldsByWorkerId(workerId);

    if (workerConfig?.allow_attendance_only_online) {
      const userStatus = await this.presenceService.getStatus(userId);

      if (userStatus !== EChatUserStatus.online) {
        throw new Error(t('attendance_only_online_allowed'));
      }
    }

    const simultaneousAttendanceLimit =
      await this.workerConfigService.viewSimultaneousAttendance(workerId);
    const simultaneousAttendanceLimitInt = Number(simultaneousAttendanceLimit);

    if (simultaneousAttendanceLimitInt > 0) {
      const currentInChatCount =
        await this.chatService.countInChatChatsByUserId(
          accountId,
          workerId,
          userId
        );

      if (currentInChatCount >= simultaneousAttendanceLimitInt) {
        throw new Error(
          t('simultaneous_attendance_limit_reached', {
            limit: simultaneousAttendanceLimit,
          })
        );
      }
    }
  }

  private async prepareUserForInChat(
    userId: string,
    enteredAt: string
  ): Promise<IChat['user'] | null | undefined> {
    const userData = await this.userService.viewUserNamePhoto(userId);

    if (!userData) {
      return null;
    }

    return {
      id: userData.id,
      name: userData.name,
      photo: userData.photo,
      entered_at: enteredAt,
    };
  }

  private buildUpdatedChat(
    chat: IChat,
    status: EChatStatus,
    user: IChat['user'] | null | undefined,
    startedAt: string | null | undefined,
    closedAt: string | null | undefined
  ): IChat {
    return {
      ...chat,
      status,
      user: user ?? chat.user,
      started_at: startedAt ?? chat.started_at,
      closed_at: closedAt ?? chat.closed_at,
      summary: {
        last_message: chat.summary?.last_message ?? null,
        last_date: chat.summary?.last_date ?? null,
        unread_count: 0,
      },
    };
  }

  private canReopenChat(actions: IJwtGroupHierarchy[]): boolean {
    const permissions = [
      EGeneralPermissions.full_access,
      EGeneralPermissions.full_access_group,
      EChatPermissions.chat_group,
      EChatPermissions.reopen_chat,
    ];

    return hasRequiredPermission(actions, permissions);
  }

  private canDisableSendMessageOnFinishAttendance(
    actions: IJwtGroupHierarchy[]
  ): boolean {
    const permissions = [
      EGeneralPermissions.full_access,
      EGeneralPermissions.full_access_group,
      EChatPermissions.chat_group,
      EChatPermissions.disable_send_message_on_finish_attendance,
    ];

    return hasRequiredPermission(actions, permissions);
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

  private async validateAccess(
    chat: IChat,
    userId: string,
    permissionRoleId: string | null,
    requestedStatus: EChatStatus,
    canManageInChatLifecycleByPermission: boolean,
    actions: IJwtGroupHierarchy[],
    userSectors: string[],
    userChannels: { id: string; name: string }[] = []
  ): Promise<void> {
    if (userChannels.length > 0) {
      const channelIds = userChannels.map((c) => c.id);
      if (!chat.worker?.id || !channelIds.includes(chat.worker.id)) {
        throw new Error('chat_access_denied');
      }
    }

    if (isMasterOrAdministratorRole(permissionRoleId)) {
      return;
    }

    if (
      requestedStatus === EChatStatus.closed &&
      chat.status === EChatStatus.in_chat &&
      canManageInChatLifecycleByPermission
    ) {
      return;
    }

    const canViewOthers = this.canViewOthersChats(actions);
    const canListAll = this.canListAllChatsWithoutSectorLimit(actions);
    const canViewInSector = this.canViewChatsInSector(actions);
    const hasPermissionToViewAll = canViewOthers || canListAll;

    if (hasPermissionToViewAll) return;

    if (
      canViewInSector &&
      userSectors.length > 0 &&
      chat.sector?.id &&
      userSectors.includes(chat.sector.id)
    ) {
      return;
    }

    if (canViewInSector && userSectors.length === 0 && !chat.sector?.id) {
      return;
    }

    if (canViewInSector && !chat.sector?.id) {
      return;
    }

    if (isChatParticipant(chat, userId)) return;

    const hasParticipants =
      !!chat.user?.id ||
      (Array.isArray(chat.secondary_users) && chat.secondary_users.length > 0);

    if (hasParticipants) {
      throw new Error('chat_access_denied');
    }

    if (!chat.user?.id) {
      if (userSectors.length > 0) {
        if (chat.sector?.id && !userSectors.includes(chat.sector.id)) {
          throw new Error('chat_access_denied');
        }
        if (!chat.sector?.id) {
          return;
        }
      } else {
        if (chat.sector?.id) {
          throw new Error('chat_access_denied');
        }
      }
    }
  }

  private async buildChatWithProtocol(
    updatedChat: IChat,
    status: EChatStatus,
    t: TFunction<'translation', undefined>,
    accountId: string,
    chatId: string,
    originalChat: IChat
  ): Promise<IChat> {
    let protocol: string | null = null;
    if (status === EChatStatus.in_chat) {
      protocol = await this.handleInChatStatus(
        t,
        accountId,
        chatId,
        originalChat
      );
    }

    const existingProtocols = updatedChat.protocol_start ?? [];
    let protocolStart: string[] | null = null;
    if (protocol) {
      const hasProtocol = existingProtocols.includes(protocol);
      protocolStart = hasProtocol
        ? existingProtocols
        : [...existingProtocols, protocol];
    }
    if (!protocol && existingProtocols.length > 0) {
      protocolStart = existingProtocols;
    }

    return {
      ...updatedChat,
      protocol_start: protocolStart,
    };
  }

  private async publishChatUpdate(
    chatWithProtocol: IChat,
    accountId: string
  ): Promise<void> {
    const channelAccountId = chatWithProtocol.account?.id ?? accountId;

    await Promise.all([
      this.centrifugoService.publishSub(
        chatAccountCentrifugo(channelAccountId),
        chatWithProtocol
      ),
      this.centrifugoService.publishSub(
        chatQueueAccountCentrifugo(channelAccountId),
        chatWithProtocol
      ),
    ]);
  }

  async execute(
    t: TFunction<'translation', undefined>,
    accountId: string,
    userId: string,
    permissionRoleId: string | null,
    userSectors: string[],
    params: UpdateChatStatusParams,
    body: UpdateChatStatusBody,
    actions: IJwtGroupHierarchy[],
    userChannels: { id: string; name: string }[] = []
  ): Promise<IChat | null> {
    const chat = await this.chatService.findChatByChatId(
      accountId,
      params.chat_id
    );

    if (!chat) {
      throw new Error(t('chat_not_found'));
    }

    const requestedStatus = body.status as EChatStatus;
    const closureComment = this.normalizeClosureComment(body.closure_comment);
    const canManageInChatLifecycleByPermission =
      this.canManageInChatLifecycle(actions);

    await this.validateAccess(
      chat,
      userId,
      permissionRoleId,
      requestedStatus,
      canManageInChatLifecycleByPermission,
      actions,
      userSectors,
      userChannels
    );

    const status = requestedStatus;
    const currentDate = new Date().toISOString();
    const isPrimaryAttendant = isChatPrimary(chat, userId);
    const isParticipantAttendant = isChatParticipant(chat, userId);
    const isMasterOrAdministrator =
      isMasterOrAdministratorRole(permissionRoleId);
    const canManageInChatLifecycle =
      isPrimaryAttendant ||
      isMasterOrAdministrator ||
      canManageInChatLifecycleByPermission;

    if (
      status === EChatStatus.closed &&
      chat.user?.id &&
      !canManageInChatLifecycle
    ) {
      throw new Error(t('chat_only_primary_can_close'));
    }

    if (
      status === EChatStatus.in_chat &&
      chat.status === EChatStatus.in_chat &&
      !isParticipantAttendant
    ) {
      throw new Error(t('chat_join_required'));
    }

    let user: IChat['user'] | null | undefined;
    let startedAt: string | null | undefined;
    let closedAt: string | null | undefined;

    const isReopeningChat =
      chat.status === EChatStatus.closed && status === EChatStatus.in_chat;

    let finalStatus = status;
    if (isReopeningChat) {
      if (!this.canReopenChat(actions)) {
        throw new Error(t('reopen_chat_permission_denied'));
      }

      await this.validatePhoneNotInActiveChat(
        t,
        accountId,
        chat.worker.id,
        chat.phone,
        chat.chat_id
      );

      await this.validateInChatAttendance(t, accountId, chat.worker.id, userId);

      user = await this.prepareUserForInChat(userId, currentDate);
      finalStatus = EChatStatus.in_chat;
    }

    if (
      finalStatus === EChatStatus.in_chat &&
      (chat.status === EChatStatus.queue ||
        chat.status === EChatStatus.ura ||
        chat.status === EChatStatus.ura_schedule ||
        chat.status === EChatStatus.ura_webhook) &&
      !chat.started_at
    ) {
      startedAt = currentDate;
    }

    if (finalStatus === EChatStatus.closed && !chat.closed_at) {
      const shouldUseUraOutput = await this.handleUraOutputStatus(
        t,
        accountId,
        chat
      );

      if (shouldUseUraOutput) {
        finalStatus = EChatStatus.ura_output;
      }

      if (finalStatus === EChatStatus.closed) {
        closedAt = currentDate;
      }
    }

    if (
      finalStatus === EChatStatus.ura_output &&
      chat.forward_to_output_chatbot === false
    ) {
      finalStatus = EChatStatus.closed;
      if (!closedAt) {
        closedAt = currentDate;
      }
    }

    if (
      finalStatus === EChatStatus.in_chat &&
      chat.status !== EChatStatus.closed &&
      chat.status !== EChatStatus.in_chat
    ) {
      await this.validateInChatAttendance(t, accountId, chat.worker.id, userId);

      user = await this.prepareUserForInChat(userId, currentDate);
    }

    const requestedDisableSendMessageOnFinishAttendance =
      body.send_message_on_finish_attendance === false;
    const canDisableSendMessageOnFinishAttendance =
      this.canDisableSendMessageOnFinishAttendance(actions);
    const shouldSendMessageOnFinishAttendance = !(
      requestedDisableSendMessageOnFinishAttendance &&
      canDisableSendMessageOnFinishAttendance
    );

    const updatedChat = this.buildUpdatedChat(
      chat,
      finalStatus,
      user,
      startedAt,
      closedAt
    );

    if (finalStatus === EChatStatus.in_chat) {
      updatedChat.forward_to_output_chatbot = true;
    } else if (
      finalStatus === EChatStatus.ura ||
      finalStatus === EChatStatus.ura_output
    ) {
      updatedChat.forward_to_output_chatbot = false;
    }

    const updated = await this.chatService.saveChat(updatedChat);
    if (!updated) {
      throw new Error(t('chat_status_update_failed'));
    }

    await this.chatService.clearChatSummary(params.chat_id, accountId);

    if (requestedStatus === EChatStatus.closed && closureComment) {
      await this.persistClosureComment({
        t,
        accountId,
        chatId: params.chat_id,
        userId,
        comment: closureComment,
        closedAt: closedAt || currentDate,
      });
    }

    if (
      finalStatus === EChatStatus.in_chat ||
      finalStatus === EChatStatus.closed ||
      finalStatus === EChatStatus.ura_output
    ) {
      await this.chatService.invalidateChatCache(updatedChat);
    }

    let chatWithProtocol = await this.buildChatWithProtocol(
      updatedChat,
      finalStatus,
      t,
      accountId,
      params.chat_id,
      chat
    );

    if (
      finalStatus === EChatStatus.closed &&
      shouldSendMessageOnFinishAttendance
    ) {
      const closedStatusResult = await this.handleClosedStatus(
        t,
        accountId,
        params.chat_id,
        updatedChat
      );

      if (closedStatusResult.protocol && closedStatusResult.persisted) {
        const existingProtocols = chatWithProtocol.protocol_start ?? [];
        const hasProtocol = existingProtocols.includes(
          closedStatusResult.protocol
        );

        chatWithProtocol = {
          ...chatWithProtocol,
          protocol_start: hasProtocol
            ? existingProtocols
            : [...existingProtocols, closedStatusResult.protocol],
        };
      }
    }

    if (finalStatus === EChatStatus.ura_output) {
      const chatbotConfig = await this.workerConfigService.viewChatbots(
        chat.worker.id
      );

      if (chatbotConfig.enabled && chatbotConfig.output_chatbot_id) {
        const bootstrapEnvelope: IUpsertMessageEnvelope = {
          key: {
            id: `status_bootstrap_${chatWithProtocol.chat_id}_${Date.now()}`,
            remoteJid: chatWithProtocol.message_key?.remote_jid ?? undefined,
            remoteJidAlt:
              chatWithProtocol.message_key?.remote_jid_alt ?? undefined,
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
          chatWithProtocol.chat_id
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
          chatWithProtocol,
          chatbotConfig.output_chatbot_id
        );
      }
    }

    await this.publishChatUpdate(chatWithProtocol, accountId);

    const hasStatusTransition = chat.status !== chatWithProtocol.status;

    if (
      hasStatusTransition &&
      (chatWithProtocol.status === EChatStatus.queue ||
        chatWithProtocol.status === EChatStatus.in_chat)
    ) {
      await this.pushNotificationService
        .sendNotificationForChatStatusChange(chatWithProtocol)
        .catch(() => {});
    }

    return chatWithProtocol;
  }
}
