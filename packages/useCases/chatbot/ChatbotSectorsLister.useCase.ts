import { injectable, inject } from 'tsyringe';
import { ChatbotService } from '@core/services/chatbot.service';
import { ListChatbotSectorsResponse } from '@core/schema/chatbot/listSectors/response.schema';

@injectable()
export class ChatbotSectorsListerUseCase {
  constructor(
    @inject(ChatbotService)
    private readonly chatbotService: ChatbotService
  ) {}

  async execute(accountId: string): Promise<ListChatbotSectorsResponse> {
    return this.chatbotService.listChatbotSectors(accountId);
  }
}
