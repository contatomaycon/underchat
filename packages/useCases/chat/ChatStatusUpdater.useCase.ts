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
import { generateProtocol } from '@core/common/functions/generateProtocol';
import { replaceMessageTags } from '@core/common/functions/replaceMessageTags';
import { ChatUserViewerRepository } from '@core/repositories/chat/ChatUserViewer.repository';
import { EChatUserStatus } from '@core/common/enums/EChatUserStatus';
import Redis from 'ioredis';
import { ETypeUserChat } from '@core/common/enums/ETypeUserChat';
import { PresenceService } from '@core/services/presence.service';

@injectable()
export class ChatStatusUpdaterUseCase {
  constructor(
    private readonly chatService: ChatService,
    private readonly centrifugoService: CentrifugoService,
    private readonly userService: UserService,
    private readonly workerService: WorkerService,
    private readonly workerConfigService: WorkerConfigService,
    private readonly chatMessageService: ChatMessageService,
    private readonly chatUserViewerRepository: ChatUserViewerRepository,
    private readonly presenceService: PresenceService,
    @inject('Redis') private readonly redis: Redis
  ) {}

  private async sendProtocolMessage(
    t: TFunction<'translation', undefined>,
    accountId: string,
    chatId: string,
    protocolText: string,
    protocolType: 'protocol_ura' | 'protocol_start' | 'protocol_transfer'
  ): Promise<string> {
    const protocol = generateProtocol();

    const chat = await this.chatService.findChatByChatId(accountId, chatId);
    if (!chat) {
      throw new Error(t('chat_not_found'));
    }

    const message = replaceMessageTags({
      message: protocolText,
      chat,
      protocol,
      t,
    });

    await Promise.all([
      this.chatMessageService.sendMessage(t, {
        chat,
        accountId,
        type: EMessageType.system,
        message,
        typeUser: ETypeUserChat.system,
      }),
      this.chatService.updateChatProtocol(chatId, protocolType, protocol),
    ]);

    return protocol;
  }

  private canViewOthersChats(actions: IJwtGroupHierarchy[]): boolean {
    const permissions = [
      EGeneralPermissions.full_access,
      EGeneralPermissions.full_access_group,
      EChatPermissions.chat_group,
      EChatPermissions.view_others_chats,
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
  ): Promise<void> {
    const workerConfigFields =
      await this.workerService.viewWorkerConfigFieldsByWorkerId(chat.worker.id);

    if (!workerConfigFields?.send_message_on_finish_attendance) {
      return;
    }

    const chatData = await this.chatService.findChatByChatId(accountId, chatId);
    if (!chatData) {
      return;
    }

    const message = replaceMessageTags({
      message: workerConfigFields.send_message_on_finish_attendance,
      chat: chatData,
      t,
    });

    await this.chatMessageService.sendMessage(t, {
      chat: chatData,
      accountId,
      type: EMessageType.text,
      message,
      typeUser: ETypeUserChat.system,
    });
  }

  private async invalidateChatCache(chat: IChat): Promise<void> {
    const cacheKey = `underchat:chat:${chat.account.id}:${chat.worker.id}:${chat.phone}`;
    const cacheKeyChat = `chat:${chat.account.id}:${chat.chat_id}`;
    await Promise.all([this.redis.del(cacheKey), this.redis.del(cacheKeyChat)]);
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
    userId: string
  ): Promise<IChat['user'] | null | undefined> {
    const userData = await this.userService.viewUserNamePhoto(userId);

    if (!userData) {
      return null;
    }

    return {
      id: userData.id,
      name: userData.name,
      photo: userData.photo,
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

  private async validateAccess(
    chat: IChat,
    userId: string,
    actions: IJwtGroupHierarchy[],
    userSectors: string[]
  ): Promise<void> {
    const canViewOthers = this.canViewOthersChats(actions);
    const canListAll = this.canListAllChatsWithoutSectorLimit(actions);
    const hasPermissionToViewAll = canViewOthers || canListAll;

    if (hasPermissionToViewAll) return;

    if (chat.user?.id && chat.user.id !== userId) {
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
      protocolStart = [...existingProtocols, protocol];
    } else if (existingProtocols.length > 0) {
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
    userSectors: string[],
    params: UpdateChatStatusParams,
    body: UpdateChatStatusBody,
    actions: IJwtGroupHierarchy[]
  ): Promise<IChat | null> {
    const chat = await this.chatService.findChatByChatId(
      accountId,
      params.chat_id
    );

    if (!chat) {
      throw new Error(t('chat_not_found'));
    }

    await this.validateAccess(chat, userId, actions, userSectors);

    const status = body.status as EChatStatus;
    const currentDate = new Date().toISOString();

    let user: IChat['user'] | null | undefined;
    let startedAt: string | null | undefined;
    let closedAt: string | null | undefined;

    const isReopeningChat =
      chat.status === EChatStatus.closed && status === EChatStatus.closed;

    let finalStatus = status;
    if (isReopeningChat) {
      await this.validatePhoneNotInActiveChat(
        t,
        accountId,
        chat.worker.id,
        chat.phone,
        chat.chat_id
      );

      await this.validateInChatAttendance(t, accountId, chat.worker.id, userId);

      user = await this.prepareUserForInChat(userId);
      finalStatus = EChatStatus.in_chat;
    }

    if (
      finalStatus === EChatStatus.in_chat &&
      (chat.status === EChatStatus.queue || chat.status === EChatStatus.ura) &&
      !chat.started_at
    ) {
      startedAt = currentDate;
    }

    if (finalStatus === EChatStatus.closed && !chat.closed_at) {
      closedAt = currentDate;
    }

    if (
      finalStatus === EChatStatus.in_chat &&
      chat.status !== EChatStatus.closed
    ) {
      await this.validateInChatAttendance(t, accountId, chat.worker.id, userId);

      user = await this.prepareUserForInChat(userId);
    }

    const updated = await this.chatService.updateChatStatus(
      params.chat_id,
      finalStatus,
      user,
      startedAt,
      closedAt
    );

    if (!updated) {
      throw new Error(t('chat_status_update_failed'));
    }

    const updatedChat = this.buildUpdatedChat(
      chat,
      finalStatus,
      user,
      startedAt,
      closedAt
    );

    await this.chatService.saveChat(updatedChat);

    if (
      finalStatus === EChatStatus.in_chat ||
      finalStatus === EChatStatus.closed
    ) {
      await this.invalidateChatCache(updatedChat);
    }

    const chatWithProtocol = await this.buildChatWithProtocol(
      updatedChat,
      finalStatus,
      t,
      accountId,
      params.chat_id,
      chat
    );

    await this.publishChatUpdate(chatWithProtocol, accountId);

    if (finalStatus === EChatStatus.closed) {
      await this.handleClosedStatus(t, accountId, params.chat_id, chat);
    }

    return chatWithProtocol;
  }
}
