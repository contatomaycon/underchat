import { injectable } from 'tsyringe';
import { ChatContactService } from '@core/services/chatContact.service';
import { ListChatContactsFinalResponse } from '@core/schema/chat/listContacts/response.schema';
import { ListChatContactsRequest } from '@core/schema/chat/listContacts/request.schema';
import { setPaginationData } from '@core/common/functions/createPaginationData';

@injectable()
export class ChatContactListerUseCase {
  constructor(private readonly chatContactService: ChatContactService) {}

  async execute(
    perPage: number,
    currentPage: number,
    accountId: string,
    query?: ListChatContactsRequest,
    allowedChannelIds: string[] = []
  ): Promise<ListChatContactsFinalResponse> {
    const [results, total] = await this.chatContactService.listChatContacts(
      perPage,
      currentPage,
      accountId,
      query,
      allowedChannelIds
    );

    const pagings = setPaginationData(
      results.length,
      total,
      perPage,
      currentPage
    );

    return {
      pagings,
      results,
    };
  }
}
