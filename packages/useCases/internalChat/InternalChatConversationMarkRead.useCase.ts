import { inject, injectable } from 'tsyringe';
import { InternalChatService } from '@core/services/internalChat.service';
import { MarkReadBody } from '@core/schema/internalChat/markRead/request.schema';

@injectable()
export class InternalChatConversationMarkReadUseCase {
  constructor(
    @inject(InternalChatService)
    private readonly internalChatService: InternalChatService
  ) {}

  async execute(
    accountId: string,
    userId: string,
    conversationId: string,
    body: MarkReadBody
  ) {
    return this.internalChatService.markConversationRead(
      accountId,
      userId,
      conversationId,
      body
    );
  }
}
