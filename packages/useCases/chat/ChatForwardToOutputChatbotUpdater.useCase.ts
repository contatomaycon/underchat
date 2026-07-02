import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import {
  UpdateForwardToOutputChatbotParams,
  UpdateForwardToOutputChatbotRequest,
} from '@core/schema/chat/updateForwardToOutputChatbot/request.schema';
import { ChatService } from '@core/services/chat.service';
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
    userChannels: { id: string; name: string }[] = []
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

    const updated = await this.chatService.updateForwardToOutputChatbot(
      params.chat_id,
      body.forward_to_output_chatbot
    );

    if (!updated) {
      throw new Error(t('chat_forward_to_output_chatbot_update_failed'));
    }

    const updatedChat: IChat = (await this.chatService.findChatByChatId(
      accountId,
      params.chat_id
    )) ?? {
      ...chat,
      forward_to_output_chatbot: body.forward_to_output_chatbot,
    };

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
