import { inject, injectable } from 'tsyringe';
import { InternalChatService } from '@core/services/internalChat.service';
import { CreateMessageBody } from '@core/schema/internalChat/createMessage/request.schema';

@injectable()
export class InternalChatMessageCreatorUseCase {
  constructor(
    @inject(InternalChatService)
    private readonly internalChatService: InternalChatService
  ) {}

  async execute(
    accountId: string,
    userId: string,
    conversationId: string,
    body: CreateMessageBody
  ) {
    return this.internalChatService.createMessage(
      accountId,
      userId,
      conversationId,
      body
    );
  }
}
