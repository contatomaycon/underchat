import { injectable } from 'tsyringe';
import { ChatUserViewerRepository } from '@core/repositories/chat/ChatUserViewer.repository';
import { ListChatsUserResponse } from '@core/schema/chat/listChatsUser/response.schema';

@injectable()
export class ChatUserService {
  constructor(
    private readonly chatUserViewerRepository: ChatUserViewerRepository
  ) {}

  viewChatUser = async (
    userId: string
  ): Promise<ListChatsUserResponse | null> => {
    return this.chatUserViewerRepository.viewChatUser(userId);
  };
}
