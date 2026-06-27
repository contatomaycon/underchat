import { injectable, inject } from 'tsyringe';
import { ChatUserViewerRepository } from '@core/repositories/chat/ChatUserViewer.repository';
import { ListChatsUserResponse } from '@core/schema/chat/listChatsUser/response.schema';
import { ChatUserUpdaterRepository } from '@core/repositories/chat/ChatUserUpdater.repository';
import { UpdateChatsUserRequest } from '@core/schema/chat/updateChatsUser/request.schema';
import {
  ChatUserPinnedChatRow,
  ChatUserPinnedRepository,
} from '@core/repositories/chat/ChatUserPinned.repository';

@injectable()
export class ChatUserService {
  constructor(
    @inject(ChatUserViewerRepository)
    private readonly chatUserViewerRepository: ChatUserViewerRepository,
    @inject(ChatUserUpdaterRepository)
    private readonly chatUserUpdaterRepository: ChatUserUpdaterRepository,
    @inject(ChatUserPinnedRepository)
    private readonly chatUserPinnedRepository: ChatUserPinnedRepository
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

  listPinnedChatsByUserId = async (
    userId: string
  ): Promise<ChatUserPinnedChatRow[]> => {
    return this.chatUserPinnedRepository.listByUserId(userId);
  };

  pinChat = async (userId: string, chatId: string): Promise<boolean> => {
    return this.chatUserPinnedRepository.pinChat(userId, chatId);
  };

  unpinChat = async (userId: string, chatId: string): Promise<boolean> => {
    return this.chatUserPinnedRepository.unpinChat(userId, chatId);
  };

  clearPinnedChatsByChatId = async (chatId: string): Promise<boolean> => {
    return this.chatUserPinnedRepository.clearPinnedChatsByChatId(chatId);
  };

  clearPinnedChatsByUserIdAndChatIds = async (
    userId: string,
    chatIds: string[]
  ): Promise<boolean> => {
    return this.chatUserPinnedRepository.clearPinnedChatsByUserIdAndChatIds(
      userId,
      chatIds
    );
  };
}
