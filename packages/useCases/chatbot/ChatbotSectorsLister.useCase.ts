import { injectable } from 'tsyringe';
import { ChatbotService } from '@core/services/chatbot.service';
import { ListChatbotSectorsResponse } from '@core/schema/chatbot/listSectors/response.schema';

@injectable()
export class ChatbotSectorsListerUseCase {
  constructor(private readonly chatbotService: ChatbotService) {}

  async execute(
    accountId: string,
    isAdministrator: boolean
  ): Promise<ListChatbotSectorsResponse> {
    return this.chatbotService.listChatbotSectors(accountId, isAdministrator);
  }
}
