import { inject, injectable } from 'tsyringe';
import { InternalChatService } from '@core/services/internalChat.service';
import { AddGroupMemberBody } from '@core/schema/internalChat/addGroupMember/request.schema';

@injectable()
export class InternalChatGroupMemberAdderUseCase {
  constructor(
    @inject(InternalChatService)
    private readonly internalChatService: InternalChatService
  ) {}

  async execute(
    accountId: string,
    userId: string,
    conversationId: string,
    body: AddGroupMemberBody
  ) {
    return this.internalChatService.addGroupMember(
      accountId,
      userId,
      conversationId,
      body
    );
  }
}
