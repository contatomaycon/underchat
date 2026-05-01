import { inject, injectable } from 'tsyringe';
import { InternalChatService } from '@core/services/internalChat.service';

@injectable()
export class InternalChatGroupMembersListerUseCase {
  constructor(
    @inject(InternalChatService)
    private readonly internalChatService: InternalChatService
  ) {}

  async execute(accountId: string, userId: string, conversationId: string) {
    return this.internalChatService.listGroupMembers(
      accountId,
      userId,
      conversationId
    );
  }
}
