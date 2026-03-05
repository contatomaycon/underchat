import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import { ChatService } from '@core/services/chat.service';
import { UserService } from '@core/services/user.service';
import { CentrifugoService } from '@core/services/centrifugo.service';
import {
  chatAccountCentrifugo,
  chatQueueAccountCentrifugo,
} from '@core/common/functions/centrifugoQueue';
import {
  JoinChatParams,
  JoinChatBody,
} from '@core/schema/chat/joinChat/request.schema';
import { IJwtGroupHierarchy } from '@core/common/interfaces/IJwtGroupHierarchy';
import { canReadChatByPolicy } from '@core/common/functions/canReadChatByPolicy';
import { EChatStatus } from '@core/common/enums/EChatStatus';
import {
  isChatPrimary,
  isChatSecondary,
} from '@core/common/functions/chatParticipants';
import { IChat } from '@core/common/interfaces/IChat';

@injectable()
export class JoinChatUseCase {
  constructor(
    @inject(ChatService)
    private readonly chatService: ChatService,
    @inject(UserService)
    private readonly userService: UserService,
    @inject(CentrifugoService)
    private readonly centrifugoService: CentrifugoService
  ) {}

  private buildUpdatedSecondaryUsers(
    chat: IChat,
    joiningUser: NonNullable<IChat['user']>
  ): IChat['secondary_users'] {
    const primaryUserId = chat.user?.id ?? null;
    const byId = new Map<string, NonNullable<IChat['user']>>();

    const existingSecondaryUsers = Array.isArray(chat.secondary_users)
      ? chat.secondary_users
      : [];

    for (const secondaryUser of existingSecondaryUsers) {
      if (!secondaryUser?.id || secondaryUser.id === primaryUserId) {
        continue;
      }
      byId.set(secondaryUser.id, secondaryUser);
    }

    if (joiningUser.id !== primaryUserId) {
      byId.set(joiningUser.id, joiningUser);
    }

    if (byId.size === 0) {
      return [];
    }

    return Array.from(byId.values());
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
    params: JoinChatParams,
    body: JoinChatBody,
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
      throw new Error(t('chat_join_only_in_chat'));
    }

    if (isChatPrimary(chat, userId) || isChatSecondary(chat, userId)) {
      return chat;
    }

    const userData = await this.userService.viewUserNamePhoto(userId);
    if (!userData) {
      throw new Error(t('user_not_found'));
    }

    const joiningUser: NonNullable<IChat['user']> = {
      id: userData.id,
      name: userData.name,
      photo: userData.photo,
    };

    const updatedChat: IChat = {
      ...chat,
      secondary_users: this.buildUpdatedSecondaryUsers(chat, joiningUser),
    };

    const saved = await this.chatService.saveChat(updatedChat);
    if (!saved) {
      throw new Error(t('chat_join_failed'));
    }

    await this.chatService.invalidateChatCache(updatedChat);
    await this.publishChatUpdate(updatedChat, accountId);

    return updatedChat;
  }
}
