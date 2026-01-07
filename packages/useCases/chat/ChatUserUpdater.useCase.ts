import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { ChatUserService } from '@core/services/chatUser.service';
import { UpdateChatsUserRequest } from '@core/schema/chat/updateChatsUser/request.schema';
import { EChatUserStatus } from '@core/common/enums/EChatUserStatus';
import { PresenceService } from '@core/services/presence.service';

@injectable()
export class ChatUserUpdaterUseCase {
  constructor(
    private readonly chatUserService: ChatUserService,
    private readonly presenceService: PresenceService
  ) {}

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

    if (input.status) {
      switch (input.status) {
        case EChatUserStatus.online:
          await this.presenceService.setUserOnline(userId);
          break;
        case EChatUserStatus.busy:
          await this.presenceService.setUserBusy(userId);
          break;
        case EChatUserStatus.do_not_disturb:
          await this.presenceService.setUserDoNotDisturb(userId);
          break;
      }
    }

    return updateChatUser;
  }
}
