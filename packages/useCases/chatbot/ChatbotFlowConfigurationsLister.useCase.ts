import { injectable } from 'tsyringe';
import { ChatbotService } from '@core/services/chatbot.service';
import { ListChatbotFlowConfigurationsResponse } from '@core/schema/chatbot/listChatbotFlowConfigurations/response.schema';

@injectable()
export class ChatbotFlowConfigurationsListerUseCase {
  constructor(private readonly chatbotService: ChatbotService) {}

  async execute(
    accountId: string,
    chatbotId: string
  ): Promise<ListChatbotFlowConfigurationsResponse | null> {
    return this.chatbotService.findChatbotFlowConfigurationsByChatbotId(
      accountId,
      chatbotId
    );
  }
}
