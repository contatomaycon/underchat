import { injectable, inject } from 'tsyringe';
import { ChatbotService } from '@core/services/chatbot.service';
import { ListChatbotResponse } from '@core/schema/chatbot/listChatbot/response.schema';

@injectable()
export class ChatbotListerUseCase {
  constructor(
    @inject(ChatbotService)
    private readonly chatbotService: ChatbotService
  ) {}

  async execute(accountId: string): Promise<ListChatbotResponse[]> {
    return this.chatbotService.listChatbots(accountId);
  }
}
