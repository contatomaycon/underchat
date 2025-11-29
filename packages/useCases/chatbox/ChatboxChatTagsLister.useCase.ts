import { injectable } from 'tsyringe';
import { ChatboxService } from '@core/services/chatbox.service';
import { ChatboxChatTagResponse } from '@core/schema/chatbox/listChatTags/response.schema';

@injectable()
export class ChatboxChatTagsListerUseCase {
  constructor(private readonly chatboxService: ChatboxService) {}

  async execute(accountId: string): Promise<ChatboxChatTagResponse[]> {
    return this.chatboxService.listChatboxTags(accountId);
  }
}
