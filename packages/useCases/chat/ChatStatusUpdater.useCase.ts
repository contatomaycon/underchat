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
import Redis from 'ioredis';

@injectable()
export class ChatStatusUpdaterUseCase {
  constructor(
    private readonly chatService: ChatService,
    private readonly centrifugoService: CentrifugoService,
    private readonly userService: UserService,
    @inject('Redis') private readonly redis: Redis
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    accountId: string,
    userId: string,
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
      chat.status === EChatStatus.queue &&
      !chat.started_at
    ) {
      startedAt = currentDate;
    }

    if (status === EChatStatus.closed && !chat.closed_at) {
      closedAt = currentDate;
    }

    if (status === EChatStatus.in_chat) {
      const userData = await this.userService.viewUserNamePhoto(userId);

      if (userData) {
        user = {
          id: userData.id,
          name: userData.name,
          photo: userData.photo,
        };
      }
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

    const updatedChat: IChat = {
      ...chat,
      status,
      user: user === undefined ? chat.user : user,
      started_at: startedAt === undefined ? chat.started_at : startedAt,
      closed_at: closedAt === undefined ? chat.closed_at : closedAt,
      summary: {
        last_message: chat.summary?.last_message ?? null,
        last_date: chat.summary?.last_date ?? null,
        unread_count: 0,
      },
    };

    await this.chatService.saveChat(updatedChat);

    if (status === EChatStatus.closed) {
      const cacheKey = `underchat:chat:${updatedChat.account.id}:${updatedChat.worker.id}:${updatedChat.phone}`;

      await this.redis.del(cacheKey);
    }

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

    return updatedChat;
  }
}
