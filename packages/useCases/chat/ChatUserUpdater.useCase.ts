import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import { ChatUserService } from '@core/services/chatUser.service';
import { UpdateChatsUserRequest } from '@core/schema/chat/updateChatsUser/request.schema';
import { EChatUserStatus } from '@core/common/enums/EChatUserStatus';
import { PresenceService } from '@core/services/presence.service';
import { IJwtGroupHierarchy } from '@core/common/interfaces/IJwtGroupHierarchy';
import { hasChatUserStatusUpdatePermissionByActions } from '@core/common/functions/chatUserStatusPermission';

@injectable()
export class ChatUserUpdaterUseCase {
  constructor(
    @inject(ChatUserService)
    private readonly chatUserService: ChatUserService,
    @inject(PresenceService)
    private readonly presenceService: PresenceService
  ) {}

  async execute(
    t: TFunction<'translation', undefined>,
    userId: string,
    actions: IJwtGroupHierarchy[],
    input: UpdateChatsUserRequest
  ): Promise<boolean> {
    const hasStatusPermission =
      hasChatUserStatusUpdatePermissionByActions(actions);

    if (input.status) {
      const statusAllowedWithoutPermission = new Set<string>([
        EChatUserStatus.online,
        EChatUserStatus.offline,
      ]);

      if (
        !hasStatusPermission &&
        !statusAllowedWithoutPermission.has(input.status)
      ) {
        throw new Error(t('chat_update_user_invalid_status'));
      }
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
        case EChatUserStatus.away:
          await this.presenceService.setUserAway(userId);
          break;
        case EChatUserStatus.busy:
          await this.presenceService.setUserBusy(userId);
          break;
        case EChatUserStatus.do_not_disturb:
          await this.presenceService.setUserDoNotDisturb(userId);
          break;
        case EChatUserStatus.offline:
          await this.presenceService.setUserOffline(userId);
          break;
      }
    }

    return updateChatUser;
  }
}
