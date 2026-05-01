import { inject, injectable } from 'tsyringe';
import { InternalChatService } from '@core/services/internalChat.service';

@injectable()
export class InternalChatContactPhoneViewerUseCase {
  constructor(
    @inject(InternalChatService)
    private readonly internalChatService: InternalChatService
  ) {}

  async execute(
    accountId: string,
    contactId: string,
    allowedChannelIds: string[] = []
  ) {
    return this.internalChatService.viewContactPhone(
      accountId,
      contactId,
      allowedChannelIds
    );
  }
}
