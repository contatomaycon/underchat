import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import { ChatService } from '@core/services/chat.service';
import type { OutboundWebhookRequestSource } from '@core/common/functions/outboundWebhookRequestSource';
import { CentrifugoService } from '@core/services/centrifugo.service';
import {
  chatAccountCentrifugo,
  chatQueueAccountCentrifugo,
} from '@core/common/functions/centrifugoQueue';
import {
  LeaveChatParams,
  LeaveChatBody,
} from '@core/schema/chat/leaveChat/request.schema';
import { IJwtGroupHierarchy } from '@core/common/interfaces/IJwtGroupHierarchy';
import { canReadChatByPolicy } from '@core/common/functions/canReadChatByPolicy';
import { EChatStatus } from '@core/common/enums/EChatStatus';
import {
  isChatPrimary,
  isChatSecondary,
} from '@core/common/functions/chatParticipants';
import { IChat } from '@core/common/interfaces/IChat';

@injectable()
export class LeaveChatUseCase {
  constructor(
    @inject(ChatService)
    private readonly chatService: ChatService,
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
    params: LeaveChatParams,
    body: LeaveChatBody,
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
      throw new Error(t('chat_leave_only_in_chat'));
    }

    if (isChatPrimary(chat, userId) || !isChatSecondary(chat, userId)) {
      throw new Error(t('chat_only_secondary_can_leave'));
    }

    const leavingUser = chat.secondary_users?.find(
      (secondaryUser) => secondaryUser.id === userId
    );
    if (!leavingUser) {
      throw new Error(t('chat_only_secondary_can_leave'));
    }

    const participantRevision =
      leavingUser.entered_at ??
      chat.meta?.assignment_event_id ??
      chat.meta?.outbound_webhook_event_ids?.at(-1) ??
      chat.started_at ??
      chat.date;

    const updatedChat = await this.chatService.mutateSecondaryUserAtomically({
      accountId,
      chat,
      operation: 'leave',
      user: leavingUser,
      outboundWebhook: {
        eventTypes: ['chat.left'],
        idempotencyKey: `chat-leave:${chat.chat_id}:${userId}:${participantRevision}`,
        source: webhookSource,
        previousChat: chat,
        actor: { type: 'user', id: userId },
        changes: {
          left_user_id: userId,
        },
      },
    });
    if (!updatedChat) {
      throw new Error(t('chat_leave_failed'));
    }

    await this.chatService.invalidateChatCache(updatedChat);
    await this.publishChatUpdate(updatedChat, accountId);

    return updatedChat;
  }
}
