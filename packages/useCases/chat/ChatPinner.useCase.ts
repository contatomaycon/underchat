import { canReadChatByPolicy } from '@core/common/functions/canReadChatByPolicy';
import { isPinnableChatStatus } from '@core/common/functions/chatPin';
import { IJwtGroupHierarchy } from '@core/common/interfaces/IJwtGroupHierarchy';
import { ChatService } from '@core/services/chat.service';
import { ChatUserService } from '@core/services/chatUser.service';
import { TFunction } from 'i18next';
import { inject, injectable } from 'tsyringe';

@injectable()
export class ChatPinnerUseCase {
  constructor(
    @inject(ChatService)
    private readonly chatService: ChatService,
    @inject(ChatUserService)
    private readonly chatUserService: ChatUserService
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    accountId: string,
    userId: string,
    actions: IJwtGroupHierarchy[],
    userSectors: string[],
    userChannels: { id: string; name: string }[] = [],
    chatId: string
  ): Promise<boolean> {
    const chat = await this.chatService.findChatByChatId(accountId, chatId);

    if (!chat) {
      throw new Error(t('chat_pin_not_found'));
    }

    const canReadChat = canReadChatByPolicy({
      chat,
      userId,
      actions,
      userSectors,
      userChannels,
    });

    if (!canReadChat) {
      throw new Error(t('chat_access_denied'));
    }

    if (!isPinnableChatStatus(chat.status)) {
      throw new Error(t('chat_pin_invalid_status'));
    }

    return this.chatUserService.pinChat(userId, chatId);
  }
}
