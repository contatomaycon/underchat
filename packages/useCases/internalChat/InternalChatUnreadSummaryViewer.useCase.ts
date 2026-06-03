import { inject, injectable } from 'tsyringe';
import { InternalChatService } from '@core/services/internalChat.service';
import type { InternalChatUnreadSummaryData } from '@core/schema/internalChat/unreadSummary/response.schema';

@injectable()
export class InternalChatUnreadSummaryViewerUseCase {
  constructor(
    @inject(InternalChatService)
    private readonly internalChatService: InternalChatService
  ) {}

  async execute(
    accountId: string,
    userId: string
  ): Promise<InternalChatUnreadSummaryData> {
    return this.internalChatService.viewUnreadSummary(accountId, userId);
  }
}
