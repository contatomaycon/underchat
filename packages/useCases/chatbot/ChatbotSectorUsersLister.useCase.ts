import { injectable, inject } from 'tsyringe';
import { ChatbotService } from '@core/services/chatbot.service';
import { ChatbotSectorUserResponse } from '@core/schema/chatbot/listSectorUsers/response.schema';

@injectable()
export class ChatbotSectorUsersListerUseCase {
  constructor(
    @inject(ChatbotService)
    private readonly chatbotService: ChatbotService
  ) {}

  async execute(
    accountId: string,
    sectorId: string,
    channelId?: string,
    userChannels: { id: string; name: string }[] = []
  ): Promise<ChatbotSectorUserResponse[]> {
    if (channelId && userChannels.length > 0) {
      const hasAccessToChannel = userChannels.some(
        (channel) => channel.id === channelId
      );

      if (!hasAccessToChannel) {
        return [];
      }
    }

    return this.chatbotService.listChatbotSectorUsers(
      accountId,
      sectorId,
      channelId
    );
  }
}
