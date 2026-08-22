import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import { ChatService } from '@core/services/chat.service';
import type { OutboundWebhookRequestSource } from '@core/common/functions/outboundWebhookRequestSource';
import { UserService } from '@core/services/user.service';
import { CentrifugoService } from '@core/services/centrifugo.service';
import {
  chatAccountCentrifugo,
  chatQueueAccountCentrifugo,
} from '@core/common/functions/centrifugoQueue';
import {
  JoinChatParams,
  JoinChatBody,
} from '@core/schema/chat/joinChat/request.schema';
import { IJwtGroupHierarchy } from '@core/common/interfaces/IJwtGroupHierarchy';
import { canReadChatByPolicy } from '@core/common/functions/canReadChatByPolicy';
import { EChatStatus } from '@core/common/enums/EChatStatus';
import {
  isChatPrimary,
  isChatSecondary,
} from '@core/common/functions/chatParticipants';
import { IChat } from '@core/common/interfaces/IChat';

@injectable()
export class JoinChatUseCase {
  constructor(
    @inject(ChatService)
    private readonly chatService: ChatService,
    @inject(UserService)
    private readonly userService: UserService,
    @inject(CentrifugoService)
    private readonly centrifugoService: CentrifugoService
  ) {}

  private async publishChatUpdate(
    chat: IChat,
    accountId: string
  ): Promise<void> {
    const channelAccountId = chat.account?.id ?? accountId;

    await Promise.all([
      this.centrifugoService.publishSub(
        chatAccountCentrifugo(channelAccountId),
        chat
      ),
      this.centrifugoService.publishSub(
        chatQueueAccountCentrifugo(channelAccountId),
        chat
      ),
    ]);
  }

  async execute(
    t: TFunction<'translation', undefined>,
    accountId: string,
    params: JoinChatParams,
    body: JoinChatBody,
    userId: string,
    actions: IJwtGroupHierarchy[],
    userSectors: string[],
    userChannels: { id: string; name: string }[] = [],
    webhookSource: OutboundWebhookRequestSource = 'manager_api'
  ): Promise<IChat> {
    void body;

    const chat = await this.chatService.findChatByChatId(
      accountId,
      params.chat_id
    );

    if (!chat) {
      throw new Error(t('chat_not_found'));
    }

    if (
      !canReadChatByPolicy({
        chat,
        userId,
        actions,
        userSectors,
        userChannels,
      })
    ) {
      throw new Error(t('chat_access_denied'));
    }

    if (chat.status !== EChatStatus.in_chat) {
      throw new Error(t('chat_join_only_in_chat'));
    }

    if (isChatPrimary(chat, userId) || isChatSecondary(chat, userId)) {
      return chat;
    }

    const userData = await this.userService.viewUserNamePhoto(userId);
    if (!userData) {
      throw new Error(t('user_not_found'));
    }

    const currentDate = new Date().toISOString();
    const joiningUser: NonNullable<IChat['user']> = {
      id: userData.id,
      name: userData.name,
      photo: userData.photo,
      entered_at: currentDate,
    };
    const participantRevision =
      chat.meta?.assignment_event_id ??
      chat.meta?.outbound_webhook_event_ids?.at(-1) ??
      chat.started_at ??
      chat.date;

    const updatedChat = await this.chatService.mutateSecondaryUserAtomically({
      accountId,
      chat,
      operation: 'join',
      user: joiningUser,
      outboundWebhook: {
        eventTypes: ['chat.joined'],
        idempotencyKey: `chat-join:${chat.chat_id}:${userId}:${participantRevision}`,
        source: webhookSource,
        previousChat: chat,
        actor: { type: 'user', id: userId },
        changes: {
          joined_user: joiningUser,
        },
      },
    });
    if (!updatedChat) {
      throw new Error(t('chat_join_failed'));
    }

    await this.chatService.invalidateChatCache(updatedChat);
    await this.publishChatUpdate(updatedChat, accountId);

    return updatedChat;
  }
}
