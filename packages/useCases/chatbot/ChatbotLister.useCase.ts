import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { ChatbotService } from '@core/services/chatbot.service';
import { ListChatbotResponse } from '@core/schema/chatbot/listChatbot/response.schema';

@injectable()
export class ChatbotListerUseCase {
  constructor(private readonly chatbotService: ChatbotService) {}

  async execute(accountId: string): Promise<ListChatbotResponse[]> {
    return this.chatbotService.listChatbots(accountId);
  }
}
