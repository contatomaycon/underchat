import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import { AccountService } from '@core/services/account.service';
import { SaveChatbotFlowConfigurationsRequest } from '@core/schema/chatbot/saveChatbotFlowConfigurations/request.schema';
import { ChatbotService } from '@core/services/chatbot.service';

@injectable()
export class ChatbotFlowConfigurationsSaverUseCase {
  constructor(
    @inject(ChatbotService)
    private readonly chatbotService: ChatbotService,
    @inject(AccountService)
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
    input: SaveChatbotFlowConfigurationsRequest,
    accountId: string
  ): Promise<string | null> {
    await this.validate(t, accountId);

    const chatbotConfigurationsId =
      await this.chatbotService.saveChatbotFlowConfigurations(input, accountId);

    if (!chatbotConfigurationsId) {
      throw new Error(t('chatbot_flow_configurations_save_error'));
    }

    return chatbotConfigurationsId;
  }
}
