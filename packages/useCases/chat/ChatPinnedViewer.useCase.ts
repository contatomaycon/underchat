import { injectable, inject } from 'tsyringe';
import { ChatService } from '@core/services/chat.service';
import { ChatUserService } from '@core/services/chatUser.service';
import { ListChatsResult } from '@core/schema/chat/listChats/response.schema';
import { IJwtGroupHierarchy } from '@core/common/interfaces/IJwtGroupHierarchy';
import { canReadChatByPolicy } from '@core/common/functions/canReadChatByPolicy';
import { isPinnableChatStatus } from '@core/common/functions/chatPin';
import { IChat } from '@core/common/interfaces/IChat';

@injectable()
export class ChatPinnedViewerUseCase {
  constructor(
    @inject(ChatService)
    private readonly chatService: ChatService,
    @inject(ChatUserService)
    private readonly chatUserService: ChatUserService
  ) {}

  private mapChatToListResult(chat: IChat): ListChatsResult {
    return {
      chat_id: chat.chat_id,
      summary: chat.summary ?? null,
      account: chat.account,
      worker: chat.worker,
      sector: chat.sector ?? null,
      user: chat.user ?? null,
      secondary_users: Array.isArray(chat.secondary_users)
        ? chat.secondary_users
        : [],
      contact: chat.contact ?? null,
      photo: chat.photo ?? null,
      name: chat.name,
      phone: chat.phone,
      status: chat.status,
      date: chat.date,
      started_at: chat.started_at ?? null,
      closed_at: chat.closed_at ?? null,
      protocol_ura: chat.protocol_ura ?? null,
      protocol_start: chat.protocol_start ?? null,
      protocol_transfer: chat.protocol_transfer ?? null,
      label: chat.label ?? null,
      forward_to_output_chatbot: chat.forward_to_output_chatbot ?? null,
    };
  }

  async execute(
    accountId: string,
    userId: string,
    actions: IJwtGroupHierarchy[],
    userSectors: string[],
    userChannels: { id: string; name: string }[] = []
  ): Promise<ListChatsResult[]> {
    const pinnedChats = await this.chatUserService.listPinnedChatsByUserId(
      userId
    );

    if (!pinnedChats.length) {
      return [];
    }

    const result: ListChatsResult[] = [];
    const staleChatIds: string[] = [];

    for (const pinnedChat of pinnedChats) {
      const chat = await this.chatService.findChatByChatId(
        accountId,
        pinnedChat.chat_id
      );

      if (!chat || !isPinnableChatStatus(chat.status)) {
        staleChatIds.push(pinnedChat.chat_id);
        continue;
      }

      const canReadChat = canReadChatByPolicy({
        chat,
        userId,
        actions,
        userSectors,
        userChannels,
      });

      if (!canReadChat) {
        staleChatIds.push(pinnedChat.chat_id);
        continue;
      }

      result.push(this.mapChatToListResult(chat));
    }

    if (staleChatIds.length) {
      await this.chatUserService.clearPinnedChatsByUserIdAndChatIds(
        userId,
        staleChatIds
      );
    }

    return result;
  }
}
