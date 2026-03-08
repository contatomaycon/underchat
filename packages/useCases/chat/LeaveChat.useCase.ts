import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import { ChatService } from '@core/services/chat.service';
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

  private normalizeUserId(value: unknown): string | null {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return String(value);
    }

    if (typeof value === 'string') {
      const normalized = value.trim();
      return normalized.length > 0 ? normalized : null;
    }

    return null;
  }

  private resolveChatUserId(user: unknown): string | null {
    if (!user || typeof user !== 'object') {
      return null;
    }

    const parsed = user as { id?: unknown; user_id?: unknown };
    return (
      this.normalizeUserId(parsed.id) ?? this.normalizeUserId(parsed.user_id)
    );
  }

  private buildUpdatedSecondaryUsers(
    chat: IChat,
    userId: string
  ): IChat['secondary_users'] {
    const primaryUserId = this.resolveChatUserId(chat.user);
    const existingSecondaryUsers = Array.isArray(chat.secondary_users)
      ? chat.secondary_users
      : [];

    return existingSecondaryUsers.filter((secondaryUser) => {
      const secondaryUserId = this.resolveChatUserId(secondaryUser);

      if (!secondaryUserId) {
        return false;
      }

      if (secondaryUserId === userId) {
        return false;
      }

      if (primaryUserId && secondaryUserId === primaryUserId) {
        return false;
      }

      return true;
    });
  }

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
    userChannels: { id: string; name: string }[] = []
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

    const updatedChat: IChat = {
      ...chat,
      secondary_users: this.buildUpdatedSecondaryUsers(chat, userId),
    };

    const saved = await this.chatService.saveChat(updatedChat);
    if (!saved) {
      throw new Error(t('chat_leave_failed'));
    }

    await this.chatService.invalidateChatCache(updatedChat);
    await this.publishChatUpdate(updatedChat, accountId);

    return updatedChat;
  }
}
