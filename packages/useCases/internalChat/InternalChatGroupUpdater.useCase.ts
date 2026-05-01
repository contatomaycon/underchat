import { inject, injectable } from 'tsyringe';
import { InternalChatService } from '@core/services/internalChat.service';
import { UpdateGroupBody } from '@core/schema/internalChat/updateGroup/request.schema';

@injectable()
export class InternalChatGroupUpdaterUseCase {
  constructor(
    @inject(InternalChatService)
    private readonly internalChatService: InternalChatService
  ) {}

  async execute(
    accountId: string,
    userId: string,
    conversationId: string,
    body: UpdateGroupBody
  ) {
    return this.internalChatService.updateGroupConversation(
      accountId,
      userId,
      conversationId,
      body
    );
  }
}
