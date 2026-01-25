import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { ChatbotService } from '@core/services/chatbot.service';

@injectable()
export class ChatbotDeleterUseCase {
  constructor(private readonly chatbotService: ChatbotService) {}

  async execute(
    t: TFunction<'translation', undefined>,
    chatbotId: string,
    accountId: string
  ): Promise<boolean> {
    const chatbots = await this.chatbotService.listChatbots(accountId);
    const chatbotExists = chatbots.some((c) => c.chatbot_id === chatbotId);

    if (!chatbotExists) {
      throw new Error(t('chatbot_not_found'));
    }

    await Promise.all([
      this.chatbotService.clearChatbotFromSchedules(chatbotId),
      this.chatbotService.clearChatbotFromWorkerConfigs(chatbotId),
      this.chatbotService.deleteChatbotFlowByChatbotId(chatbotId),
      this.chatbotService.deleteChatbotFlowConfigurationsByChatbotId(chatbotId),
    ]);

    const deleted = await this.chatbotService.deleteChatbotById(chatbotId);

    if (!deleted) {
      throw new Error(t('chatbot_deleter_error'));
    }

    return true;
  }
}
