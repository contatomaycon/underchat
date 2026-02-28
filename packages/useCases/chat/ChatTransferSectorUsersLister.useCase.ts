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
    sectorId: string,
    chatId?: string,
    channelId?: string
  ): Promise<TransferSectorUserResponse[]> {
    const sectorUsers = await this.sectorService.listSectorUsersForTransfer(
      accountId,
      sectorId
    );

    let targetChannelId = channelId;

    if (!targetChannelId && chatId) {
      const chat = await this.chatService.findChatByChatId(accountId, chatId);
      targetChannelId = chat?.worker?.id;
    }

    if (!targetChannelId) {
      return sectorUsers;
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
    return sectorUsers.filter((u) => allowedSet.has(u.id));
  }
}
