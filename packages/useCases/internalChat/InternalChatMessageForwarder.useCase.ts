import { inject, injectable } from 'tsyringe';
import { InternalChatService } from '@core/services/internalChat.service';
import { ForwardMessageBody } from '@core/schema/internalChat/forwardMessage/request.schema';

@injectable()
export class InternalChatMessageForwarderUseCase {
  constructor(
    @inject(InternalChatService)
    private readonly internalChatService: InternalChatService
  ) {}

  async execute(
    accountId: string,
    userId: string,
    conversationId: string,
    messageId: string,
    body: ForwardMessageBody
  ) {
    return this.internalChatService.forwardMessage(
      accountId,
      userId,
      conversationId,
      messageId,
      body
    );
  }
}
