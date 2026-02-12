import { injectable, inject } from 'tsyringe';
import { ChatContactService } from '@core/services/chatContact.service';
import { ViewChatContactsBatchResponse } from '@core/schema/chat/viewContactsBatch/response.schema';

@injectable()
export class ChatContactsBatchViewerUseCase {
  constructor(
    @inject(ChatContactService)
    private readonly chatContactService: ChatContactService
  ) {}

  async execute(
    contactIds: string[],
    accountId: string,
    allowedChannelIds: string[] = []
  ): Promise<ViewChatContactsBatchResponse> {
    return this.chatContactService.viewChatContactsByIds(
      contactIds,
      accountId,
      allowedChannelIds
    );
  }
}
