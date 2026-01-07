import { injectable } from 'tsyringe';
import { ChatbotService } from '@core/services/chatbot.service';
import { ListChatbotAiAgentsResponse } from '@core/schema/chatbot/listAiAgents/response.schema';

@injectable()
export class ChatbotAiAgentsListerUseCase {
  constructor(private readonly chatbotService: ChatbotService) {}

  async execute(accountId: string): Promise<ListChatbotAiAgentsResponse> {
    return this.chatbotService.listChatbotAiAgents(accountId);
  }
}
