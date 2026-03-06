import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import { ChatService } from '@core/services/chat.service';
import { canReadChatByPolicy } from '@core/common/functions/canReadChatByPolicy';
import { hasRequiredPermission } from '@core/common/functions/hasRequiredPermission';
import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';
import { EChatPermissions } from '@core/common/enums/EPermissions/chat';
import { IJwtGroupHierarchy } from '@core/common/interfaces/IJwtGroupHierarchy';
import { ViewChatAttendantsResponse } from '@core/schema/chat/viewChatAttendants/response.schema';
import { ViewChatAttendantsParams } from '@core/schema/chat/viewChatAttendants/request.schema';
import { IChat } from '@core/common/interfaces/IChat';

@injectable()
export class ChatAttendantsViewerUseCase {
  constructor(
    @inject(ChatService)
    private readonly chatService: ChatService
  ) {}

  private canViewChatAttendantsInfo(actions: IJwtGroupHierarchy[]): boolean {
    if (!actions?.length) {
      return false;
    }

    const permissions = [
      EGeneralPermissions.full_access,
      EGeneralPermissions.full_access_group,
      EChatPermissions.chat_group,
      EChatPermissions.view_chat_attendants_info,
    ];

    return hasRequiredPermission(actions, permissions);
  }

  private normalizeAttendant(
    user: IChat['user'] | null | undefined
  ): ViewChatAttendantsResponse['primary_user'] {
    if (!user?.id) {
      return null;
    }

    return {
      id: user.id,
      name: user.name,
      photo: user.photo ?? null,
      entered_at: user.entered_at ?? null,
    };
  }

  private normalizeSecondaryAttendants(
    chat: IChat
  ): ViewChatAttendantsResponse['secondary_users'] {
    const primaryUserId = chat.user?.id ?? null;
    const secondaryUsers = Array.isArray(chat.secondary_users)
      ? chat.secondary_users
      : [];

    const byId = new Map<string, NonNullable<IChat['user']>>();

    for (const secondaryUser of secondaryUsers) {
      if (!secondaryUser?.id || secondaryUser.id === primaryUserId) {
        continue;
      }

      if (!byId.has(secondaryUser.id)) {
        byId.set(secondaryUser.id, secondaryUser);
      }
    }

    return Array.from(byId.values()).map((secondaryUser) => ({
      id: secondaryUser.id,
      name: secondaryUser.name,
      photo: secondaryUser.photo ?? null,
      entered_at: secondaryUser.entered_at ?? null,
    }));
  }

  async execute(
    t: TFunction<'translation', undefined>,
    accountId: string,
    params: ViewChatAttendantsParams,
    userId: string,
    actions: IJwtGroupHierarchy[],
    userSectors: string[],
    userChannels: { id: string; name: string }[] = []
  ): Promise<ViewChatAttendantsResponse> {
    const chat = await this.chatService.findChatByChatId(
      accountId,
      params.chat_id
    );

    if (!chat) {
      throw new Error(t('chat_not_found'));
    }

    if (!this.canViewChatAttendantsInfo(actions)) {
      throw new Error(t('chat_attendants_info_permission_denied'));
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

    return {
      primary_user: this.normalizeAttendant(chat.user),
      secondary_users: this.normalizeSecondaryAttendants(chat),
    };
  }
}
