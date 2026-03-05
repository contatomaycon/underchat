import { injectable, inject } from 'tsyringe';
import { SectorService } from '@core/services/sector.service';
import { ChatService } from '@core/services/chat.service';
import { UserService } from '@core/services/user.service';
import { TransferSectorUserResponse } from '@core/schema/chat/listTransferSectorUsers/response.schema';

@injectable()
export class ChatTransferSectorUsersListerUseCase {
  constructor(
    @inject(SectorService)
    private readonly sectorService: SectorService,
    @inject(ChatService)
    private readonly chatService: ChatService,
    @inject(UserService)
    private readonly userService: UserService
  ) {}

  async execute(
    accountId: string,
    actorUserId: string,
    sectorId: string,
    chatId?: string,
    channelId?: string
  ): Promise<TransferSectorUserResponse[]> {
    const sectorUsers = await this.sectorService.listSectorUsersForTransfer(
      accountId,
      sectorId
    );

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
        return sectorUsers;
      }

      return sectorUsers.filter((user) => user.id !== chat?.user?.id);
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
    const allowedUsers = sectorUsers.filter((user) => allowedSet.has(user.id));

    if (!shouldExcludeCurrentPrimary) {
      return allowedUsers;
    }

    return allowedUsers.filter((user) => user.id !== chat?.user?.id);
  }
}
