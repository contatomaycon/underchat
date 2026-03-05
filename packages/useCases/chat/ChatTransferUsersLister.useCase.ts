import { injectable, inject } from 'tsyringe';
import { UserService } from '@core/services/user.service';
import { ChatService } from '@core/services/chat.service';
import { ListTransferUsersResponse } from '@core/schema/chat/listTransferUsers/response.schema';

@injectable()
export class ChatTransferUsersListerUseCase {
  constructor(
    @inject(UserService)
    private readonly userService: UserService,
    @inject(ChatService)
    private readonly chatService: ChatService
  ) {}

  async execute(
    accountId: string,
    actorUserId: string,
    chatId?: string,
    channelId?: string
  ): Promise<ListTransferUsersResponse> {
    const allUsers = await this.userService.listUsersForTransfer(accountId);

    const chat = chatId
      ? await this.chatService.findChatByChatId(accountId, chatId)
      : null;

    let targetChannelId = channelId;

    if (!targetChannelId) {
      targetChannelId = chat?.worker?.id;
    }

    const shouldExcludeCurrentPrimary =
      !!chat?.user?.id && chat.user.id === actorUserId;

    if (!targetChannelId) {
      if (!shouldExcludeCurrentPrimary) {
        return allUsers;
      }

      return allUsers.filter((user) => user.id !== chat?.user?.id);
    }

    const userIdsWithAccess =
      await this.userService.listUserIdsWithAccessToChannel(
        accountId,
        targetChannelId
      );

    if (userIdsWithAccess.length === 0) {
      return [];
    }

    const allowedSet = new Set(userIdsWithAccess);
    const allowedUsers = allUsers.filter((user) => allowedSet.has(user.id));

    if (!shouldExcludeCurrentPrimary) {
      return allowedUsers;
    }

    return allowedUsers.filter((user) => user.id !== chat?.user?.id);
  }
}
