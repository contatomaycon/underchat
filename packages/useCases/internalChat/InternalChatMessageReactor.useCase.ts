import { inject, injectable } from 'tsyringe';
import { InternalChatService } from '@core/services/internalChat.service';
import { ReactMessageBody } from '@core/schema/internalChat/reactMessage/request.schema';

@injectable()
export class InternalChatMessageReactorUseCase {
  constructor(
    @inject(InternalChatService)
    private readonly internalChatService: InternalChatService
  ) {}

  async execute(
    accountId: string,
    userId: string,
    conversationId: string,
    messageId: string,
    body: ReactMessageBody
  ) {
    return this.internalChatService.reactMessage(
      accountId,
      userId,
      conversationId,
      messageId,
      body
    );
  }
}
