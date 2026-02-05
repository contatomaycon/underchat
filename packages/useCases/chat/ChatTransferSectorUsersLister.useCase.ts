import { injectable } from 'tsyringe';
import { SectorService } from '@core/services/sector.service';
import { ChatService } from '@core/services/chat.service';
import { UserService } from '@core/services/user.service';
import { TransferSectorUserResponse } from '@core/schema/chat/listTransferSectorUsers/response.schema';

@injectable()
export class ChatTransferSectorUsersListerUseCase {
  constructor(
    private readonly sectorService: SectorService,
    private readonly chatService: ChatService,
    private readonly userService: UserService
  ) {}

  async execute(
    accountId: string,
    sectorId: string,
    chatId?: string
  ): Promise<TransferSectorUserResponse[]> {
    const sectorUsers = await this.sectorService.listSectorUsersForTransfer(
      accountId,
      sectorId
    );

    if (!chatId) {
      return sectorUsers;
    }

    const chat = await this.chatService.findChatByChatId(accountId, chatId);
    if (!chat?.worker?.id) {
      return sectorUsers;
    }

    const userIdsWithAccess =
      await this.userService.listUserIdsWithAccessToChannel(
        accountId,
        chat.worker.id
      );

    if (userIdsWithAccess.length === 0) {
      return [];
    }

    const allowedSet = new Set(userIdsWithAccess);
    return sectorUsers.filter((u) => allowedSet.has(u.id));
  }
}
