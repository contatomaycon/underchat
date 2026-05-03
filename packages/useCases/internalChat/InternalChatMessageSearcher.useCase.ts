import { inject, injectable } from 'tsyringe';
import { InternalChatService } from '@core/services/internalChat.service';
import { SearchInternalChatMessagesQuery } from '@core/schema/internalChat/searchMessages/request.schema';

@injectable()
export class InternalChatMessageSearcherUseCase {
  constructor(
    @inject(InternalChatService)
    private readonly internalChatService: InternalChatService
  ) {}

  async execute(
    accountId: string,
    userId: string,
    conversationId: string,
    query: SearchInternalChatMessagesQuery
  ) {
    return this.internalChatService.searchMessages(
      accountId,
      userId,
      conversationId,
      query
    );
  }
}
