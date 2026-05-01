import { inject, injectable } from 'tsyringe';
import { InternalChatService } from '@core/services/internalChat.service';
import { TransferLeaderBody } from '@core/schema/internalChat/transferLeader/request.schema';

@injectable()
export class InternalChatGroupLeaderTransferUseCase {
  constructor(
    @inject(InternalChatService)
    private readonly internalChatService: InternalChatService
  ) {}

  async execute(
    accountId: string,
    userId: string,
    conversationId: string,
    body: TransferLeaderBody
  ) {
    return this.internalChatService.transferGroupLeader(
      accountId,
      userId,
      conversationId,
      body
    );
  }
}
