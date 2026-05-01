import { inject, injectable } from 'tsyringe';
import { InternalChatService } from '@core/services/internalChat.service';
import { ListConversationsQuery } from '@core/schema/internalChat/listConversations/request.schema';

@injectable()
export class InternalChatConversationsListerUseCase {
  constructor(
    @inject(InternalChatService)
    private readonly internalChatService: InternalChatService
  ) {}

  async execute(
    accountId: string,
    userId: string,
    query: ListConversationsQuery
  ) {
    return this.internalChatService.listConversations(accountId, userId, query);
  }
}
