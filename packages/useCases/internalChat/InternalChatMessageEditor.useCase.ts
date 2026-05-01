import { inject, injectable } from 'tsyringe';
import { InternalChatService } from '@core/services/internalChat.service';
import { EditMessageBody } from '@core/schema/internalChat/editMessage/request.schema';

@injectable()
export class InternalChatMessageEditorUseCase {
  constructor(
    @inject(InternalChatService)
    private readonly internalChatService: InternalChatService
  ) {}

  async execute(
    accountId: string,
    userId: string,
    conversationId: string,
    messageId: string,
    body: EditMessageBody
  ) {
    return this.internalChatService.editMessage(
      accountId,
      userId,
      conversationId,
      messageId,
      body
    );
  }
}
