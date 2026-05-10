import { injectable, inject } from 'tsyringe';
import { ChatbotService } from '@core/services/chatbot.service';
import { ListChatbotUsersResponse } from '@core/schema/chatbot/listUsers/response.schema';

@injectable()
export class ChatbotUsersListerUseCase {
  constructor(
    @inject(ChatbotService)
    private readonly chatbotService: ChatbotService
  ) {}

  async execute(
    accountId: string,
    channelId?: string,
    userChannels: { id: string; name: string }[] = []
  ): Promise<ListChatbotUsersResponse> {
    if (channelId && userChannels.length > 0) {
      const hasAccessToChannel = userChannels.some(
        (channel) => channel.id === channelId
      );

      if (!hasAccessToChannel) {
        return [];
      }
    }

    return this.chatbotService.listChatbotUsers(accountId, channelId);
  }
}
