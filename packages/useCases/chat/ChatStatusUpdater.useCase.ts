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
import { IChat } from '@core/common/interfaces/IChat';
import { EChatStatus } from '@core/common/enums/EChatStatus';
import { UserService } from '@core/services/user.service';
import { WorkerService } from '@core/services/worker.service';
import { WorkerConfigService } from '@core/services/workerConfig.service';
import { ChatMessageService } from '@core/services/chatMessage.service';
import { EMessageType } from '@core/common/enums/EMessageType';
import { generateProtocol } from '@core/common/functions/generateProtocol';
import { AutomaticAttendanceService } from '@core/services/automaticAttendance.service';
import { ChatUserViewerRepository } from '@core/repositories/chat/ChatUserViewer.repository';
import { EChatUserStatus } from '@core/common/enums/EChatUserStatus';
import Redis from 'ioredis';
import { ETypeUserChat } from '@core/common/enums/ETypeUserChat';

@injectable()
export class ChatStatusUpdaterUseCase {
  constructor(
    private readonly chatService: ChatService,
    private readonly centrifugoService: CentrifugoService,
    private readonly userService: UserService,
    private readonly workerService: WorkerService,
    private readonly workerConfigService: WorkerConfigService,
    private readonly chatMessageService: ChatMessageService,
    private readonly automaticAttendanceService: AutomaticAttendanceService,
    private readonly chatUserViewerRepository: ChatUserViewerRepository,
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
    const message = protocolText.replaceAll(
      /\{\{\s*protocolo\s*\}\}/gi,
      protocol
    );

    const chat = await this.chatService.findChatByChatId(accountId, chatId);
    if (!chat) {
      throw new Error(t('chat_not_found'));
    }

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

    await this.chatMessageService.sendMessage(t, {
      chat: chatData,
      accountId,
      type: EMessageType.text,
      message: workerConfigFields.send_message_on_finish_attendance,
      typeUser: ETypeUserChat.system,
    });
  }

  private async invalidateChatCache(chat: IChat): Promise<void> {
    const cacheKey = `underchat:chat:${chat.account.id}:${chat.worker.id}:${chat.phone}`;
    const cacheKeyChat = `chat:${chat.account.id}:${chat.chat_id}`;
    await Promise.all([this.redis.del(cacheKey), this.redis.del(cacheKeyChat)]);
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
      const userStatus =
        await this.chatUserViewerRepository.findStatusByUserId(userId);

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
    body: UpdateChatStatusBody
  ): Promise<IChat | null> {
    const chat = await this.chatService.findChatByChatId(
      accountId,
      params.chat_id
    );

    if (!chat) {
      throw new Error(t('chat_not_found'));
    }

    const status = body.status as EChatStatus;
    const currentDate = new Date().toISOString();

    let user: IChat['user'] | null | undefined;
    let startedAt: string | null | undefined;
    let closedAt: string | null | undefined;

    if (
      status === EChatStatus.in_chat &&
      (chat.status === EChatStatus.queue || chat.status === EChatStatus.ura) &&
      !chat.started_at
    ) {
      startedAt = currentDate;
    }

    if (status === EChatStatus.closed && !chat.closed_at) {
      closedAt = currentDate;
    }

    if (status === EChatStatus.in_chat) {
      await this.validateInChatAttendance(t, accountId, chat.worker.id, userId);

      user = await this.prepareUserForInChat(userId);
    }

    const updated = await this.chatService.updateChatStatus(
      params.chat_id,
      status,
      user,
      startedAt,
      closedAt
    );

    if (!updated) {
      throw new Error(t('chat_status_update_failed'));
    }

    const updatedChat = this.buildUpdatedChat(
      chat,
      status,
      user,
      startedAt,
      closedAt
    );

    await this.chatService.saveChat(updatedChat);

    if (status === EChatStatus.in_chat || status === EChatStatus.closed) {
      await this.invalidateChatCache(updatedChat);
    }

    const chatWithProtocol = await this.buildChatWithProtocol(
      updatedChat,
      status,
      t,
      accountId,
      params.chat_id,
      chat
    );

    await this.publishChatUpdate(chatWithProtocol, accountId);

    if (status === EChatStatus.closed) {
      await Promise.all([
        this.handleClosedStatus(t, accountId, params.chat_id, chat),
        this.automaticAttendanceService.handleAutomaticAttendance(
          t,
          accountId,
          chat.worker.id,
          userId,
          userSectors,
          params.chat_id
        ),
      ]);
    }

    return chatWithProtocol;
  }
}
