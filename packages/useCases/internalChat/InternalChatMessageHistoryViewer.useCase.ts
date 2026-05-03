import { inject, injectable } from 'tsyringe';
import { InternalChatService } from '@core/services/internalChat.service';

@injectable()
export class InternalChatMessageHistoryViewerUseCase {
  constructor(
    @inject(InternalChatService)
    private readonly internalChatService: InternalChatService
  ) {}

  async execute(
    accountId: string,
    userId: string,
    conversationId: string,
    messageId: string
  ) {
    return this.internalChatService.viewMessageHistory(
      accountId,
      userId,
      conversationId,
      messageId
    );
  }
}
