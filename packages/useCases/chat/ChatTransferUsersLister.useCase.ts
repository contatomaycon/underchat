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
    chatId?: string,
    channelId?: string
  ): Promise<ListTransferUsersResponse> {
    const allUsers = await this.userService.listUsersForTransfer(accountId);

    let targetChannelId = channelId;

    if (!targetChannelId && chatId) {
      const chat = await this.chatService.findChatByChatId(accountId, chatId);
      targetChannelId = chat?.worker?.id;
    }

    if (!targetChannelId) {
      return allUsers;
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
    return allUsers.filter((u) => allowedSet.has(u.id));
  }
}
