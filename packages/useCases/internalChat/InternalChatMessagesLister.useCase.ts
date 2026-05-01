import { inject, injectable } from 'tsyringe';
import { InternalChatService } from '@core/services/internalChat.service';
import { ListMessagesQuery } from '@core/schema/internalChat/listMessages/request.schema';

@injectable()
export class InternalChatMessagesListerUseCase {
  constructor(
    @inject(InternalChatService)
    private readonly internalChatService: InternalChatService
  ) {}

  async execute(
    accountId: string,
    userId: string,
    conversationId: string,
    query: ListMessagesQuery
  ) {
    return this.internalChatService.listMessages(
      accountId,
      userId,
      conversationId,
      query
    );
  }
}
