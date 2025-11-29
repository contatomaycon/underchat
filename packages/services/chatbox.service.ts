import { injectable } from 'tsyringe';
import { ChatboxChatTagsListerRepository } from '@core/repositories/labelTemplate/ChatboxChatTagsLister.repository';
import { ChatboxChatTagResponse } from '@core/schema/chatbox/listChatTags/response.schema';

@injectable()
export class ChatboxService {
  constructor(
    private readonly chatboxChatTagsListerRepository: ChatboxChatTagsListerRepository
  ) {}

  listChatboxTags = async (
    accountId: string
  ): Promise<ChatboxChatTagResponse[]> => {
    return this.chatboxChatTagsListerRepository.listChatboxChatTags(accountId);
  };
}
