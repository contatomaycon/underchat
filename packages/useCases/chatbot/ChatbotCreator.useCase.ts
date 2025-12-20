import { injectable } from 'tsyringe';
import { TFunction } from 'i18next';
import { AccountService } from '@core/services/account.service';
import { CreateChatbotRequest } from '@core/schema/chatbot/createChatbot/request.schema';
import { CreateChatbotResponse } from '@core/schema/chatbot/createChatbot/response.schema';
import { ChatbotService } from '@core/services/chatbot.service';
import { PlanAccountService } from '@core/services/planAccount.service';

@injectable()
export class ChatbotCreatorUseCase {
  constructor(
    private readonly chatbotService: ChatbotService,
    private readonly accountService: AccountService,
    private readonly planAccountService: PlanAccountService
  ) {}

  async validate(
    t: TFunction<'translation', undefined>,
    input: CreateChatbotRequest,
    accountId: string
  ): Promise<void> {
    const accountExists =
      await this.accountService.existsAccountById(accountId);
    if (!accountExists) {
      throw new Error(t('account_not_found'));
    }

    const nameExists = await this.chatbotService.existsChatbotByName(
      input.name,
      accountId
    );
    if (nameExists) {
      throw new Error(t('chatbot_name_already_exists'));
    }
  }

  async execute(
    t: TFunction<'translation', undefined>,
    input: CreateChatbotRequest,
    accountId: string
  ): Promise<CreateChatbotResponse | null> {
    await this.validate(t, input, accountId);
    await this.planAccountService.validateCanCreateChatbot(t, accountId);

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
