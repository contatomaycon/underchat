import { injectable, inject } from 'tsyringe';
import { ChatbotService } from '@core/services/chatbot.service';
import { ListChatbotUsersResponse } from '@core/schema/chatbot/listUsers/response.schema';

@injectable()
export class ChatbotUsersListerUseCase {
  constructor(
    @inject(ChatbotService)
    private readonly chatbotService: ChatbotService
  ) {}

  async execute(accountId: string): Promise<ListChatbotUsersResponse> {
    return this.chatbotService.listChatbotUsers(accountId);
  }
}
