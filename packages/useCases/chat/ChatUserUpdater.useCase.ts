import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { ChatUserService } from '@core/services/chatUser.service';
import { UpdateChatsUserRequest } from '@core/schema/chat/updateChatsUser/request.schema';
import { EChatUserStatus } from '@core/common/enums/EChatUserStatus';

@injectable()
export class ChatUserUpdaterUseCase {
  constructor(private readonly chatUserService: ChatUserService) {}

  async execute(
    t: TFunction<'translation', undefined>,
    userId: string,
    input: UpdateChatsUserRequest
  ): Promise<boolean> {
    if (
      input.status === EChatUserStatus.away ||
      input.status === EChatUserStatus.offline
    ) {
      throw new Error(t('chat_update_user_invalid_status'));
    }

    const updateChatUser = await this.chatUserService.updateChatUser(
      userId,
      input
    );

    if (!updateChatUser) {
      throw new Error(t('chat_update_user_not_found'));
    }

    return updateChatUser;
  }
}
