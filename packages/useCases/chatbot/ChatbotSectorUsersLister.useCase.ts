import { injectable, inject } from 'tsyringe';
import { ChatbotService } from '@core/services/chatbot.service';
import { ChatbotSectorUserResponse } from '@core/schema/chatbot/listSectorUsers/response.schema';

@injectable()
export class ChatbotSectorUsersListerUseCase {
  constructor(
    @inject(ChatbotService)
    private readonly chatbotService: ChatbotService
  ) {}

  async execute(
    accountId: string,
    sectorId: string
  ): Promise<ChatbotSectorUserResponse[]> {
    return this.chatbotService.listChatbotSectorUsers(accountId, sectorId);
  }
}
