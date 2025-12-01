import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { ChatbotService } from '@core/services/chatbot.service';
import { UpdateChatbotRequest } from '@core/schema/chatbot/updateChatbot/request.schema';
import { UpdateChatbotResponse } from '@core/schema/chatbot/updateChatbot/response.schema';

@injectable()
export class ChatbotUpdaterUseCase {
  constructor(private readonly chatbotService: ChatbotService) {}

  async validate(
    t: TFunction<'translation', undefined>,
    input: UpdateChatbotRequest,
    chatbotId: string,
    accountId: string
  ): Promise<void> {
    const nameExists = await this.chatbotService.existsChatbotByName(
      input.name,
      accountId,
      chatbotId
    );
    if (nameExists) {
      throw new Error(t('chatbot_name_already_exists'));
    }
  }

  async execute(
    t: TFunction<'translation', undefined>,
    chatbotId: string,
    input: UpdateChatbotRequest,
    accountId: string
  ): Promise<UpdateChatbotResponse | null> {
    await this.validate(t, input, chatbotId, accountId);

    const chatbotUpdater = await this.chatbotService.updateChatbot(
      chatbotId,
      input
    );

    if (!chatbotUpdater) {
      throw new Error(t('chatbot_update_error'));
    }

    return chatbotUpdater;
  }
}
