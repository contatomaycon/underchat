import { injectable, inject } from 'tsyringe';
import { ChatbotService } from '@core/services/chatbot.service';
import { ListChatbotFlowResponse } from '@core/schema/chatbot/listChatbotFlow/response.schema';

@injectable()
export class ChatbotFlowListerUseCase {
  constructor(
    @inject(ChatbotService)
    private readonly chatbotService: ChatbotService
  ) {}

  async execute(
    accountId: string,
    chatbotId: string
  ): Promise<ListChatbotFlowResponse | null> {
    return this.chatbotService.findChatbotFlowByChatbotId(accountId, chatbotId);
  }
}
