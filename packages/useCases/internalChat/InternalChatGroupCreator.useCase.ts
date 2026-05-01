import { inject, injectable } from 'tsyringe';
import { InternalChatService } from '@core/services/internalChat.service';
import { CreateGroupBody } from '@core/schema/internalChat/createGroup/request.schema';

@injectable()
export class InternalChatGroupCreatorUseCase {
  constructor(
    @inject(InternalChatService)
    private readonly internalChatService: InternalChatService
  ) {}

  async execute(accountId: string, userId: string, body: CreateGroupBody) {
    return this.internalChatService.createGroupConversation(
      accountId,
      userId,
      body
    );
  }
}
