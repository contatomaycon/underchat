import { injectable, inject } from 'tsyringe';
import { ChatbotService } from '@core/services/chatbot.service';
import { ChatbotChatTagResponse } from '@core/schema/chatbot/listChatTags/response.schema';

@injectable()
export class ChatbotChatTagsListerUseCase {
  constructor(
    @inject(ChatbotService)
    private readonly chatbotService: ChatbotService
  ) {}

  async execute(accountId: string): Promise<ChatbotChatTagResponse[]> {
    return this.chatbotService.listChatbotTags(accountId);
  }
}
