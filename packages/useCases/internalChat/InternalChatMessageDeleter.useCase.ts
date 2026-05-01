import { inject, injectable } from 'tsyringe';
import { InternalChatService } from '@core/services/internalChat.service';

@injectable()
export class InternalChatMessageDeleterUseCase {
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
    return this.internalChatService.deleteMessage(
      accountId,
      userId,
      conversationId,
      messageId
    );
  }
}
