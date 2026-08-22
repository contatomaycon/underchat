import { injectable, inject } from 'tsyringe';
import { ChatbotService } from '@core/services/chatbot.service';
import { ListChatbotChannelsResponse } from '@core/schema/chatbot/listChannels/response.schema';
import { IJwtGroupHierarchy } from '@core/common/interfaces/IJwtGroupHierarchy';
import { canViewAllChannelsForTransferAndForwarding } from '@core/common/functions/transferAndForwardChannelAccess';

@injectable()
export class ChatbotChannelsListerUseCase {
  constructor(
    @inject(ChatbotService)
    private readonly chatbotService: ChatbotService
  ) {}

  async execute(
    accountId: string,
    userChannels: { id: string; name: string }[] = [],
    actions: IJwtGroupHierarchy[] = []
  ): Promise<ListChatbotChannelsResponse> {
    return this.chatbotService.listChatbotChannels(
      accountId,
      canViewAllChannelsForTransferAndForwarding(actions) ? [] : userChannels
    );
  }
}
