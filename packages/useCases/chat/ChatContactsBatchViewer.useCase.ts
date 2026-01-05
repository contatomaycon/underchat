import { injectable } from 'tsyringe';
import { ChatContactService } from '@core/services/chatContact.service';
import { ViewChatContactsBatchResponse } from '@core/schema/chat/viewContactsBatch/response.schema';

@injectable()
export class ChatContactsBatchViewerUseCase {
  constructor(private readonly chatContactService: ChatContactService) {}

  async execute(
    contactIds: string[],
    accountId: string
  ): Promise<ViewChatContactsBatchResponse> {
    return this.chatContactService.viewChatContactsByIds(contactIds, accountId);
  }
}
