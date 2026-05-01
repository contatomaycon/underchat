import { inject, injectable } from 'tsyringe';
import { InternalChatService } from '@core/services/internalChat.service';
import { ListInternalChatContactsRequest } from '@core/schema/internalChat/listContacts/request.schema';

@injectable()
export class InternalChatContactsListerUseCase {
  constructor(
    @inject(InternalChatService)
    private readonly internalChatService: InternalChatService
  ) {}

  async execute(
    accountId: string,
    query: ListInternalChatContactsRequest,
    allowedChannelIds: string[] = []
  ) {
    return this.internalChatService.listContacts(
      accountId,
      query,
      allowedChannelIds
    );
  }
}
