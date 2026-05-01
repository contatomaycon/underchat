import { inject, injectable } from 'tsyringe';
import { InternalChatService } from '@core/services/internalChat.service';

@injectable()
export class InternalChatGroupMemberRemoverUseCase {
  constructor(
    @inject(InternalChatService)
    private readonly internalChatService: InternalChatService
  ) {}

  async execute(
    accountId: string,
    userId: string,
    conversationId: string,
    memberUserId: string
  ) {
    return this.internalChatService.removeGroupMember(
      accountId,
      userId,
      conversationId,
      memberUserId
    );
  }
}
