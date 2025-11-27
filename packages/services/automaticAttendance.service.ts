import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import { ChatService } from './chat.service';
import { UserService } from './user.service';
import { WorkerService } from './worker.service';
import { WorkerConfigService } from './workerConfig.service';
import { CentrifugoService } from './centrifugo.service';
import { SectorService } from './sector.service';
import {
  chatAccountCentrifugo,
  chatQueueAccountCentrifugo,
} from '@core/common/functions/centrifugoQueue';
import { IChat } from '@core/common/interfaces/IChat';
import { EChatStatus } from '@core/common/enums/EChatStatus';
import { EMessageType } from '@core/common/enums/EMessageType';
import { CreateMessageChatsBody } from '@core/schema/chat/createMessageChats/request.schema';
import { ChatMessageCreatorUseCase } from '@core/useCases/chat/ChatMessageCreator.useCase';
import { generateProtocol } from '@core/common/functions/generateProtocol';
import { IViewUserNamePhoto } from '@core/common/interfaces/IViewUserNamePhoto';
import Redis from 'ioredis';

@injectable()
export class AutomaticAttendanceService {
  constructor(
    private readonly chatService: ChatService,
    private readonly userService: UserService,
    private readonly workerService: WorkerService,
    private readonly workerConfigService: WorkerConfigService,
    private readonly centrifugoService: CentrifugoService,
    private readonly chatMessageCreatorUseCase: ChatMessageCreatorUseCase,
    private readonly sectorService: SectorService,
    @inject('Redis') private readonly redis: Redis
  ) {}

  private normalizeSimultaneousAttendanceLimit(
    value: number | string | null | undefined
  ): { limit: number | null; hasLimit: boolean } {
    const parsed = value === null || value === undefined ? null : Number(value);

    if (!Number.isFinite(parsed) || parsed <= 0) {
      return { limit: null, hasLimit: false };
    }

    return { limit: parsed, hasLimit: true };
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

  async handleAutomaticAttendance(
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

    const { limit: simultaneousAttendanceLimit, hasLimit } =
      this.normalizeSimultaneousAttendanceLimit(
        workerConfig.simultaneous_attendance
      );

    const queueChats = await this.chatService.findQueueChatsByWorkerId(
      accountId,
      workerId,
      userId,
      excludeChatId
    );

    if (queueChats.length === 0) {
      return;
    }

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

        const [saved] = await Promise.all([
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

  private async shouldProcessAutomaticAttendance(workerId: string): Promise<{
    shouldProcess: boolean;
    simultaneousAttendanceLimit: number | null;
    hasLimit: boolean;
  }> {
    const workerConfig =
      await this.workerConfigService.viewWorkerConfig(workerId);

    if (!workerConfig?.is_automatic_attendance) {
      return {
        shouldProcess: false,
        simultaneousAttendanceLimit: null,
        hasLimit: false,
      };
    }

    const { limit: simultaneousAttendanceLimit, hasLimit } =
      this.normalizeSimultaneousAttendanceLimit(
        workerConfig.simultaneous_attendance
      );

    return { shouldProcess: true, simultaneousAttendanceLimit, hasLimit };
  }

  private async getCandidateUsers(
    accountId: string,
    sectorId?: string | null
  ): Promise<IViewUserNamePhoto[]> {
    const onlineUsers =
      await this.userService.listOnlineUsersByAccount(accountId);

    if (onlineUsers.length === 0) {
      return [];
    }

    if (!sectorId) {
      return onlineUsers;
    }

    const sectorUsers = await this.sectorService.listSectorUsers(
      accountId,
      sectorId
    );

    const sectorUserIds = sectorUsers.map((su) => su.user_id);
    return onlineUsers.filter((ou) => sectorUserIds.includes(ou.id));
  }

  private async calculateUserLoads(
    accountId: string,
    workerId: string,
    users: IViewUserNamePhoto[],
    simultaneousAttendanceLimit: number | null,
    hasLimit: boolean
  ): Promise<
    Array<{
      user: IViewUserNamePhoto;
      load: number;
      inChat: number;
      queue: number;
      isAtLimit: boolean;
    }>
  > {
    return Promise.all(
      users.map(async (user) => {
        const load = await this.chatService.countTotalChatsByUserId(
          accountId,
          workerId,
          user.id
        );

        const isAtLimit =
          hasLimit && load.inChat >= simultaneousAttendanceLimit!;

        return {
          user,
          load: load.total,
          inChat: load.inChat,
          queue: load.queue,
          isAtLimit,
        };
      })
    );
  }

  private selectBestUser(
    userLoads: Array<{
      user: IViewUserNamePhoto;
      load: number;
      inChat: number;
      queue: number;
      isAtLimit: boolean;
    }>
  ): IViewUserNamePhoto | null {
    const availableUsers = userLoads.filter((ul) => !ul.isAtLimit);

    if (availableUsers.length === 0) {
      return null;
    }

    availableUsers.sort((a, b) => {
      if (a.load !== b.load) {
        return a.load - b.load;
      }
      return a.user.id.localeCompare(b.user.id);
    });

    return availableUsers[0].user;
  }

  private async processAutomaticAttendance(
    t: TFunction<'translation', undefined>,
    chat: IChat,
    selectedUser: IViewUserNamePhoto,
    accountId: string,
    workerId: string,
    chatId: string
  ): Promise<void> {
    const currentDate = new Date().toISOString();
    const startedAt = chat.started_at ?? currentDate;

    const user: IChat['user'] = {
      id: selectedUser.id,
      name: selectedUser.name,
      photo: selectedUser.photo ?? null,
    };

    const updated = await this.chatService.updateChatStatus(
      chatId,
      EChatStatus.in_chat,
      user,
      startedAt,
      null
    );

    if (!updated) {
      return;
    }

    const updatedChat: IChat = {
      ...chat,
      status: EChatStatus.in_chat,
      user,
      started_at: startedAt,
      summary: {
        last_message: chat.summary?.last_message ?? null,
        last_date: chat.summary?.last_date ?? null,
        unread_count: 0,
      },
    };

    const channelAccountId = updatedChat.account?.id ?? accountId;

    const [saved] = await Promise.all([
      this.chatService.saveChat(updatedChat),
      this.invalidateChatCache(updatedChat),
    ]);

    if (!saved) {
      return;
    }

    const workerConfigFields =
      await this.workerService.viewWorkerConfigFieldsByWorkerId(workerId);

    const protocolPromise = workerConfigFields?.generate_protocol_at_start
      ? this.sendProtocolMessage(
          t,
          accountId,
          chatId,
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
      selectedUser.id
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
  }

  async handleAutomaticAttendanceForNewChat(
    t: TFunction<'translation', undefined>,
    chat: IChat
  ): Promise<void> {
    const accountId = chat.account.id;
    const workerId = chat.worker.id;
    const chatId = chat.chat_id;

    const { shouldProcess, simultaneousAttendanceLimit, hasLimit } =
      await this.shouldProcessAutomaticAttendance(workerId);

    if (!shouldProcess) {
      return;
    }

    const candidateUsers = await this.getCandidateUsers(
      accountId,
      chat.sector?.id
    );

    if (candidateUsers.length === 0) {
      return;
    }

    const userLoads = await this.calculateUserLoads(
      accountId,
      workerId,
      candidateUsers,
      simultaneousAttendanceLimit,
      hasLimit
    );

    const selectedUser = this.selectBestUser(userLoads);

    if (!selectedUser) {
      return;
    }

    if (hasLimit) {
      const currentInChatCount =
        await this.chatService.countInChatChatsByUserId(
          accountId,
          workerId,
          selectedUser.id
        );

      if (
        simultaneousAttendanceLimit !== null &&
        currentInChatCount >= simultaneousAttendanceLimit
      ) {
        return;
      }
    }

    await this.processAutomaticAttendance(
      t,
      chat,
      selectedUser,
      accountId,
      workerId,
      chatId
    );
  }
}
