import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import { ChatService } from './chat.service';
import { UserService } from './user.service';
import { WorkerService } from './worker.service';
import { WorkerConfigService } from './workerConfig.service';
import { CentrifugoService } from './centrifugo.service';
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
    @inject('Redis') private readonly redis: Redis
  ) {}

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
}
