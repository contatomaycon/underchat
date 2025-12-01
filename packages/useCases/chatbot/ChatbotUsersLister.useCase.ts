import { injectable } from 'tsyringe';
import { ChatbotService } from '@core/services/chatbot.service';
import { ListChatbotUsersResponse } from '@core/schema/chatbot/listUsers/response.schema';

@injectable()
export class ChatbotUsersListerUseCase {
  constructor(private readonly chatbotService: ChatbotService) {}

  async execute(
    accountId: string,
    excludeUserId: string
  ): Promise<ListChatbotUsersResponse> {
    return this.chatbotService.listChatbotUsers(accountId, excludeUserId);
  }
}
