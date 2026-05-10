import { injectable, inject } from 'tsyringe';
import { ChatbotService } from '@core/services/chatbot.service';
import { ListChatbotChannelsResponse } from '@core/schema/chatbot/listChannels/response.schema';

@injectable()
export class ChatbotChannelsListerUseCase {
  constructor(
    @inject(ChatbotService)
    private readonly chatbotService: ChatbotService
  ) {}

  async execute(
    accountId: string,
    userChannels: { id: string; name: string }[] = []
  ): Promise<ListChatbotChannelsResponse> {
    return this.chatbotService.listChatbotChannels(accountId, userChannels);
  }
}
