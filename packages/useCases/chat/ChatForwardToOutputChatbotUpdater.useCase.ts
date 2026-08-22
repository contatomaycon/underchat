import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import {
  UpdateForwardToOutputChatbotParams,
  UpdateForwardToOutputChatbotRequest,
} from '@core/schema/chat/updateForwardToOutputChatbot/request.schema';
import { ChatService } from '@core/services/chat.service';
import type { OutboundWebhookRequestSource } from '@core/common/functions/outboundWebhookRequestSource';
import { CentrifugoService } from '@core/services/centrifugo.service';
import {
  chatAccountCentrifugo,
  chatQueueAccountCentrifugo,
} from '@core/common/functions/centrifugoQueue';
import { IChat } from '@core/common/interfaces/IChat';

@injectable()
export class ChatForwardToOutputChatbotUpdaterUseCase {
  constructor(
    @inject(ChatService)
    private readonly chatService: ChatService,
    @inject(CentrifugoService)
    private readonly centrifugoService: CentrifugoService
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    accountId: string,
    params: UpdateForwardToOutputChatbotParams,
    body: UpdateForwardToOutputChatbotRequest,
    userChannels: { id: string; name: string }[] = [],
    actorUserId?: string,
    webhookSource: OutboundWebhookRequestSource = 'manager_api'
  ): Promise<boolean> {
    const chat = await this.chatService.findChatByChatId(
      accountId,
      params.chat_id
    );

    if (!chat) {
      throw new Error(t('chat_not_found'));
    }

    if (userChannels.length > 0) {
      const channelIds = userChannels.map((c) => c.id);
      if (!chat.worker?.id || !channelIds.includes(chat.worker.id)) {
        throw new Error(t('chat_access_denied'));
      }
    }

    if (chat.forward_to_output_chatbot === body.forward_to_output_chatbot) {
      return true;
    }

    const previousRoutingRevision =
      chat.meta?.outbound_webhook_event_ids?.at(-1) ??
      chat.meta?.status_event_id ??
      chat.started_at ??
      chat.date;

    const updated = await this.chatService.updateForwardToOutputChatbot(
      params.chat_id,
      body.forward_to_output_chatbot,
      {
        eventTypes: ['chat.updated'],
        idempotencyKey: `chat-output-routing:${chat.chat_id}:${String(
          chat.forward_to_output_chatbot ?? false
        )}:${String(body.forward_to_output_chatbot)}:${previousRoutingRevision}`,
        source: webhookSource,
        previousChat: chat,
        actor: actorUserId ? { type: 'user', id: actorUserId } : null,
        changes: {
          forward_to_output_chatbot: body.forward_to_output_chatbot,
        },
      }
    );

    if (!updated) {
      throw new Error(t('chat_forward_to_output_chatbot_update_failed'));
    }

    const updatedChat: IChat | null = await this.chatService.findChatByChatId(
      accountId,
      params.chat_id
    );
    if (!updatedChat) {
      throw new Error(t('chat_forward_to_output_chatbot_update_failed'));
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

    return true;
  }
}
