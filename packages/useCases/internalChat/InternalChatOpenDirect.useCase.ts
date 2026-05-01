import { inject, injectable } from 'tsyringe';
import { InternalChatService } from '@core/services/internalChat.service';
import { OpenDirectBody } from '@core/schema/internalChat/openDirect/request.schema';

@injectable()
export class InternalChatOpenDirectUseCase {
  constructor(
    @inject(InternalChatService)
    private readonly internalChatService: InternalChatService
  ) {}

  async execute(accountId: string, userId: string, body: OpenDirectBody) {
    return this.internalChatService.openDirectConversation(
      accountId,
      userId,
      body.target_user_id
    );
  }
}
