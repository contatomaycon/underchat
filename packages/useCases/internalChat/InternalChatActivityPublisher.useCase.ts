import { inject, injectable } from 'tsyringe';
import { InternalChatService } from '@core/services/internalChat.service';
import { ActivityBody } from '@core/schema/internalChat/activity/request.schema';

@injectable()
export class InternalChatActivityPublisherUseCase {
  constructor(
    @inject(InternalChatService)
    private readonly internalChatService: InternalChatService
  ) {}

  async execute(accountId: string, userId: string, body: ActivityBody) {
    return this.internalChatService.publishActivity(accountId, userId, body);
  }
}
