import { injectable } from 'tsyringe';
import { ChatUserViewerRepository } from '@core/repositories/chat/ChatUserViewer.repository';
import { ListChatsUserResponse } from '@core/schema/chat/listChatsUser/response.schema';
import { ChatUserUpdaterRepository } from '@core/repositories/chat/ChatUserUpdater.repository';
import { UpdateChatsUserRequest } from '@core/schema/chat/updateChatsUser/request.schema';

@injectable()
export class ChatUserService {
  constructor(
    private readonly chatUserViewerRepository: ChatUserViewerRepository,
    private readonly chatUserUpdaterRepository: ChatUserUpdaterRepository
  ) {}

  viewChatUser = async (
    userId: string
  ): Promise<ListChatsUserResponse | null> => {
    return this.chatUserViewerRepository.viewChatUser(userId);
  };

  updateChatUser = async (
    userId: string,
    input: UpdateChatsUserRequest
  ): Promise<boolean> => {
    return this.chatUserUpdaterRepository.updateChatUser(userId, input);
  };
}
