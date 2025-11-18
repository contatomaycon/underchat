import { injectable } from 'tsyringe';
import { ChatService } from '@core/services/chat.service';
import { TFunction } from 'i18next';
import { IChat } from '@core/common/interfaces/IChat';
import { CentrifugoService } from '@core/services/centrifugo.service';
import { chatQueueAccountCentrifugo } from '@core/common/functions/centrifugoQueue';

@injectable()
export class ChatSummaryClearerUseCase {
  constructor(
    private readonly chatService: ChatService,
    private readonly centrifugoService: CentrifugoService
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    accountId: string,
    chatIds: string[]
  ): Promise<IChat[]> {
    const chats = await Promise.all(
      chatIds.map((chatId) =>
        this.chatService.findChatByChatId(accountId, chatId)
      )
    );

    const validChats = chats.filter((chat): chat is IChat => chat !== null);

    if (validChats.length === 0) {
      throw new Error(t('chat_not_found'));
    }

    const clearResults = await Promise.all(
      validChats.map((chat) =>
        this.chatService.clearChatSummary(chat.chat_id, accountId)
      )
    );

    if (clearResults.some((result) => !result)) {
      throw new Error(t('chat_summary_clear_failed'));
    }

    const updatedChats = await Promise.all(
      validChats.map((chat) =>
        this.chatService.findChatByChatId(accountId, chat.chat_id)
      )
    );

    const validUpdatedChats = updatedChats.filter(
      (chat): chat is IChat => chat !== null
    );

    const channelAccountIds = new Set(
      validUpdatedChats.map((chat) => chat.account.id)
    );

    await Promise.all(
      Array.from(channelAccountIds).flatMap((channelAccountId) => {
        const chatsForChannel = validUpdatedChats.filter(
          (chat) => chat.account.id === channelAccountId
        );

        return chatsForChannel.map((chat) =>
          this.centrifugoService.publishSub(
            chatQueueAccountCentrifugo(channelAccountId),
            chat
          )
        );
      })
    );

    return validUpdatedChats;
  }
}
