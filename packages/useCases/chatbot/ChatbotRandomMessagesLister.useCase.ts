import { injectable, inject } from 'tsyringe';
import { ChatbotService } from '@core/services/chatbot.service';
import { ListChatbotRandomMessagesResponse } from '@core/schema/chatbot/listRandomMessages/response.schema';

@injectable()
export class ChatbotRandomMessagesListerUseCase {
  constructor(
    @inject(ChatbotService)
    private readonly chatbotService: ChatbotService
  ) {}

  async execute(accountId: string): Promise<ListChatbotRandomMessagesResponse> {
    return this.chatbotService.listChatbotRandomMessages(accountId);
  }
}
