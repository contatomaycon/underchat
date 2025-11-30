import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { AccountService } from '@core/services/account.service';
import { CreateChatbotRequest } from '@core/schema/chatbot/createChatbot/request.schema';
import { CreateChatbotResponse } from '@core/schema/chatbot/createChatbot/response.schema';
import { ChatbotService } from '@core/services/chatbot.service';

@injectable()
export class ChatbotCreatorUseCase {
  constructor(
    private readonly chatbotService: ChatbotService,
    private readonly accountService: AccountService
  ) {}

  async validate(
    t: TFunction<'translation', undefined>,
    accountId: string
  ): Promise<void> {
    const accountExists =
      await this.accountService.existsAccountById(accountId);
    if (!accountExists) {
      throw new Error(t('account_not_found'));
    }
  }

  async execute(
    t: TFunction<'translation', undefined>,
    input: CreateChatbotRequest,
    accountId: string
  ): Promise<CreateChatbotResponse | null> {
    await this.validate(t, accountId);

    const chatbotCreator = await this.chatbotService.createChatbot(
      input,
      accountId
    );

    if (!chatbotCreator) {
      throw new Error(t('chatbot_creator_error'));
    }

    return chatbotCreator;
  }
}
