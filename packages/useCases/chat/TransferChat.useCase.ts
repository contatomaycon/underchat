import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import { ChatService } from '@core/services/chat.service';
import { UserService } from '@core/services/user.service';
import { SectorService } from '@core/services/sector.service';
import { ChatMessageCreatorUseCase } from './ChatMessageCreator.useCase';
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
import { CreateMessageChatsBody } from '@core/schema/chat/createMessageChats/request.schema';
import { WorkerService } from '@core/services/worker.service';
import { WorkerConfigService } from '@core/services/workerConfig.service';
import { generateProtocol } from '@core/common/functions/generateProtocol';
import Redis from 'ioredis';

@injectable()
export class TransferChatUseCase {
  constructor(
    private readonly chatService: ChatService,
    private readonly userService: UserService,
    private readonly sectorService: SectorService,
    private readonly chatMessageCreatorUseCase: ChatMessageCreatorUseCase,
    private readonly centrifugoService: CentrifugoService,
    private readonly workerService: WorkerService,
    private readonly workerConfigService: WorkerConfigService,
    @inject('Redis') private readonly redis: Redis
  ) {}

  private async loadUserAndSector(
    body: TransferChatBody,
    accountId: string,
    isAdministrator: boolean
  ): Promise<{
    userData: Awaited<ReturnType<UserService['viewUserNamePhoto']>> | null;
    sectorData: Awaited<ReturnType<SectorService['viewSectorById']>> | null;
  }> {
    const userPromise = body.user_id
      ? this.userService.viewUserNamePhoto(body.user_id)
      : Promise.resolve(null);
    const sectorPromise = body.sector_id
      ? this.sectorService.viewSectorById(
          body.sector_id,
          accountId,
          isAdministrator
        )
      : Promise.resolve(null);

    const [userData, sectorData] = await Promise.all([
      userPromise,
      sectorPromise,
    ]);

    return { userData, sectorData };
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

  private buildUserFromData(
    body: TransferChatBody,
    userData: Awaited<ReturnType<UserService['viewUserNamePhoto']>> | null
  ): IChat['user'] | null | undefined {
    if (!body.user_id) return undefined;

    if (!userData) return undefined;

    return {
      id: userData.id,
      name: userData.name,
      photo: userData.photo,
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
    };
  }

  private async sendAnnotationMessage(
    t: TFunction<'translation', undefined>,
    accountId: string,
    chatId: string,
    annotation: string
  ): Promise<void> {
    const messageBody: CreateMessageChatsBody = {
      type: EMessageType.annotation,
      message: annotation.trim(),
    };

    await this.chatMessageCreatorUseCase.execute(
      t,
      accountId,
      {
        chat_id: chatId,
      },
      messageBody
    );
  }

  private async sendProtocolMessage(
    t: TFunction<'translation', undefined>,
    accountId: string,
    chatId: string,
    protocolText: string
  ): Promise<void> {
    const protocol = generateProtocol();
    const message = protocolText.replaceAll(
      /\{\{\s*protocolo\s*\}\}/gi,
      protocol
    );

    const protocolMessageBody: CreateMessageChatsBody = {
      type: EMessageType.system,
      message,
    };

    await this.chatMessageCreatorUseCase.execute(
      t,
      accountId,
      {
        chat_id: chatId,
      },
      protocolMessageBody
    );
  }

  private async invalidateChatCache(chat: IChat): Promise<void> {
    const cacheKey = `underchat:chat:${chat.account.id}:${chat.worker.id}:${chat.phone}`;
    const cacheKeyChat = `chat:${chat.account.id}:${chat.chat_id}`;
    await Promise.all([this.redis.del(cacheKey), this.redis.del(cacheKeyChat)]);
  }

  private async handleAutomaticAttendance(
    t: TFunction<'translation', undefined>,
    accountId: string,
    workerId: string,
    userId: string,
    excludeChatId?: string
  ): Promise<void> {
    const workerConfig =
      await this.workerConfigService.viewWorkerConfig(workerId);

    if (!workerConfig?.is_automatic_attendance) {
      return;
    }

    const queueChats = await this.chatService.findQueueChatsByWorkerId(
      accountId,
      workerId,
      userId,
      excludeChatId
    );

    if (queueChats.length === 0) {
      return;
    }

    const simultaneousAttendanceLimit =
      workerConfig.simultaneous_attendance ?? null;
    const hasLimit =
      simultaneousAttendanceLimit !== null && simultaneousAttendanceLimit > 0;

    if (hasLimit) {
      const currentInChatCount =
        await this.chatService.countInChatChatsByUserId(
          accountId,
          workerId,
          userId
        );

      if (currentInChatCount >= simultaneousAttendanceLimit) {
        return;
      }
    }

    const userChats = queueChats.filter((chat) => chat.user?.id === userId);
    const otherChats = queueChats.filter((chat) => chat.user?.id !== userId);
    const chatsToProcess = [...userChats, ...otherChats];

    const [userData, workerConfigFields] = await Promise.all([
      this.userService.viewUserNamePhoto(userId),
      this.workerService.viewWorkerConfigFieldsByWorkerId(workerId),
    ]);

    if (!userData) {
      return;
    }

    const user: IChat['user'] = {
      id: userData.id,
      name: userData.name,
      photo: userData.photo,
    };

    const currentDate = new Date().toISOString();
    const processPromises: Promise<void>[] = [];

    for (const queueChat of chatsToProcess) {
      if (hasLimit) {
        const currentInChatCount =
          await this.chatService.countInChatChatsByUserId(
            accountId,
            workerId,
            userId
          );

        if (currentInChatCount >= simultaneousAttendanceLimit) {
          break;
        }
      }

      const startedAt = queueChat.started_at ?? currentDate;

      const processPromise = (async () => {
        const updated = await this.chatService.updateChatStatus(
          queueChat.chat_id,
          EChatStatus.in_chat,
          user,
          startedAt,
          null
        );

        if (!updated) {
          return;
        }

        const updatedChat: IChat = {
          ...queueChat,
          status: EChatStatus.in_chat,
          user,
          started_at: startedAt,
          summary: {
            last_message: queueChat.summary?.last_message ?? null,
            last_date: queueChat.summary?.last_date ?? null,
            unread_count: 0,
          },
        };

        const channelAccountId = updatedChat.account?.id ?? accountId;

        const [saved, cacheInvalidated] = await Promise.all([
          this.chatService.saveChat(updatedChat),
          this.invalidateChatCache(updatedChat),
        ]);

        if (!saved) {
          return;
        }

        const protocolPromise = workerConfigFields?.generate_protocol_at_start
          ? this.sendProtocolMessage(
              t,
              accountId,
              queueChat.chat_id,
              workerConfigFields.generate_protocol_at_start
            )
          : Promise.resolve();

        const publishPromises = [
          this.centrifugoService.publishSub(
            chatAccountCentrifugo(channelAccountId),
            updatedChat
          ),
          this.centrifugoService.publishSub(
            chatQueueAccountCentrifugo(channelAccountId),
            updatedChat
          ),
        ];

        await Promise.all([protocolPromise, ...publishPromises]);

        const userInChatCount = await this.chatService.countInChatChatsByUserId(
          accountId,
          workerId,
          userId
        );

        if (userInChatCount === 1) {
          await this.centrifugoService.publishSub(
            chatAccountCentrifugo(channelAccountId),
            {
              ...updatedChat,
              _active: true,
            } as any
          );
        }
      })();

      processPromises.push(processPromise);
    }

    await Promise.all(processPromises);
  }

  async execute(
    t: TFunction<'translation', undefined>,
    accountId: string,
    isAdministrator: boolean,
    params: TransferChatParams,
    body: TransferChatBody,
    userId: string
  ): Promise<{ chat_id: string; status: boolean }> {
    const chat = await this.chatService.findChatByChatId(
      accountId,
      params.chat_id
    );

    if (!chat) {
      throw new Error(t('chat_not_found'));
    }

    const { userData, sectorData } = await this.loadUserAndSector(
      body,
      accountId,
      isAdministrator
    );

    const workerConfigFields =
      await this.workerService.viewWorkerConfigFieldsByWorkerId(chat.worker.id);

    let user = this.buildUserFromData(body, userData);
    let sector = this.buildSectorFromData(body, sectorData);

    const shouldClearUser = body.sector_id && !body.user_id;
    const shouldClearSector = body.user_id && !body.sector_id;

    if (shouldClearUser) {
      user = null;
    }

    if (shouldClearSector) {
      sector = null;
    }

    this.validateUserAndSector(t, body, user, sector);

    const updatedChat: IChat = {
      ...chat,
      status: EChatStatus.queue,
      user: shouldClearUser ? null : (user ?? chat.user),
      sector: shouldClearSector ? null : (sector ?? chat.sector),
    };

    const saved = await this.chatService.saveChat(updatedChat);

    if (!saved) {
      throw new Error(t('chat_transfer_failed'));
    }

    await this.invalidateChatCache(updatedChat);

    const channelAccountId = updatedChat.account?.id ?? accountId;

    await Promise.all([
      this.centrifugoService.publishSub(
        chatAccountCentrifugo(channelAccountId),
        updatedChat
      ),
      this.centrifugoService.publishSub(
        chatQueueAccountCentrifugo(channelAccountId),
        updatedChat
      ),
    ]);

    if (body.annotation?.trim()) {
      await this.sendAnnotationMessage(
        t,
        accountId,
        params.chat_id,
        body.annotation
      );
    }

    if (workerConfigFields?.generate_protocol_at_transfer) {
      await this.sendProtocolMessage(
        t,
        accountId,
        params.chat_id,
        workerConfigFields.generate_protocol_at_transfer
      );
    }

    await this.handleAutomaticAttendance(
      t,
      accountId,
      chat.worker.id,
      userId,
      params.chat_id
    );

    return {
      chat_id: params.chat_id,
      status: true,
    };
  }
}
