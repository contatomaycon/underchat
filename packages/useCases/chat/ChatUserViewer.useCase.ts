import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { ListChatsUserResponse } from '@core/schema/chat/listChatsUser/response.schema';
import { ChatUserService } from '@core/services/chatUser.service';

@injectable()
export class ChatUserViewerUseCase {
  constructor(private readonly chatUserService: ChatUserService) {}

  async execute(
    t: TFunction<'translation', undefined>,
    userId: string
  ): Promise<ListChatsUserResponse | null> {
    const viewChatUser = await this.chatUserService.viewChatUser(userId);

    if (!viewChatUser) {
      throw new Error(t('chat_list_user_not_found'));
    }

    return viewChatUser;
  }
}
