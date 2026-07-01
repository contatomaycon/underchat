import { injectable, inject } from 'tsyringe';
import { ChatbotService } from '@core/services/chatbot.service';
import { OfficialCapabilitiesResponse } from '@core/schema/chatbot/officialCapabilities/response.schema';

@injectable()
export class ChatbotOfficialCapabilitiesUseCase {
  constructor(
    @inject(ChatbotService)
    private readonly chatbotService: ChatbotService
  ) {}

  async execute(
    accountId: string,
    chatbotId: string,
    userChannels: { id: string; name: string }[] = []
  ): Promise<OfficialCapabilitiesResponse> {
    return this.chatbotService.getOfficialCapabilities(
      accountId,
      chatbotId,
      userChannels
    );
  }
}
