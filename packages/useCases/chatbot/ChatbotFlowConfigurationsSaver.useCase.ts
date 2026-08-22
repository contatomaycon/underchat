import { injectable, inject } from 'tsyringe';
import { TFunction } from 'i18next';
import { AccountService } from '@core/services/account.service';
import { SaveChatbotFlowConfigurationsRequest } from '@core/schema/chatbot/saveChatbotFlowConfigurations/request.schema';
import { ChatbotService } from '@core/services/chatbot.service';
import { ChatService } from '@core/services/chat.service';
import { WorkerService } from '@core/services/worker.service';
import { IJwtGroupHierarchy } from '@core/common/interfaces/IJwtGroupHierarchy';
import { canUseChannelForTransferAndForwarding } from '@core/common/functions/transferAndForwardChannelAccess';

@injectable()
export class ChatbotFlowConfigurationsSaverUseCase {
  constructor(
    @inject(ChatbotService)
    private readonly chatbotService: ChatbotService,
    @inject(AccountService)
    private readonly accountService: AccountService,
    @inject(ChatService)
    private readonly chatService: ChatService,
    @inject(WorkerService)
    private readonly workerService: WorkerService
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
    accountId: string,
    userChannels: { id: string; name: string }[] = [],
    actions: IJwtGroupHierarchy[] = []
  ): Promise<string | null> {
    await this.validate(t, accountId);

    const normalizedInput = await this.normalizeAndValidateInput(
      t,
      input,
      accountId,
      userChannels,
      actions
    );

    const chatbotConfigurationsId =
      await this.chatbotService.saveChatbotFlowConfigurations(
        normalizedInput,
        accountId
      );

    if (!chatbotConfigurationsId) {
      throw new Error(t('chatbot_flow_configurations_save_error'));
    }

    return chatbotConfigurationsId;
  }

  private async normalizeAndValidateInput(
    t: TFunction<'translation', undefined>,
    input: SaveChatbotFlowConfigurationsRequest,
    accountId: string,
    userChannels: { id: string; name: string }[],
    actions: IJwtGroupHierarchy[]
  ): Promise<SaveChatbotFlowConfigurationsRequest> {
    const inactivityAlert = input.configurations.inactivity_alert;
    if (!inactivityAlert) {
      return input;
    }

    this.validateInactivityAlertTiming(t, inactivityAlert);

    const {
      redirect_type,
      selected_user,
      selected_sector,
      selected_sector_user,
      selected_channel,
      selected_chatbot,
      ...baseAlert
    } = inactivityAlert;

    let normalizedAlert: typeof inactivityAlert = baseAlert;
    if (inactivityAlert.action === 'redirect') {
      if (redirect_type === 'user') {
        normalizedAlert = { ...baseAlert, redirect_type, selected_user };
      } else if (redirect_type === 'sector') {
        normalizedAlert = {
          ...baseAlert,
          redirect_type,
          selected_sector,
          selected_sector_user,
        };
      } else if (redirect_type === 'chatbot') {
        if (!selected_channel) {
          throw new Error(t('channel_required'));
        }
        if (!selected_chatbot) {
          throw new Error(t('chatbot_required'));
        }
        if (
          !canUseChannelForTransferAndForwarding(
            selected_channel,
            userChannels,
            actions
          )
        ) {
          throw new Error(t('chat_access_denied'));
        }

        const worker = await this.workerService.viewWorkerNameAndId(
          accountId,
          selected_channel
        );
        if (!worker) {
          throw new Error(t('worker_not_found'));
        }

        const config =
          await this.chatService.viewWorkerConfigForChat(selected_channel);
        const linkedChatbotIds = new Set(
          [config?.input_chatbot, config?.output_chatbot]
            .filter((chatbot) => chatbot !== null && chatbot !== undefined)
            .map((chatbot) => chatbot.chatbot_id)
        );
        if (!linkedChatbotIds.has(selected_chatbot)) {
          throw new Error(t('chatbot_not_found'));
        }

        normalizedAlert = {
          ...baseAlert,
          redirect_type,
          selected_channel,
          selected_chatbot,
        };
      }
    }

    return {
      ...input,
      configurations: {
        ...input.configurations,
        inactivity_alert: normalizedAlert,
      },
    };
  }

  private validateInactivityAlertTiming(
    t: TFunction<'translation', undefined>,
    inactivityAlert: SaveChatbotFlowConfigurationsRequest['configurations']['inactivity_alert']
  ): void {
    if (inactivityAlert?.status !== 'active') {
      return;
    }

    if (
      !Number.isInteger(inactivityAlert.quantity) ||
      inactivityAlert.quantity < 1
    ) {
      throw new Error(
        t('chatbot_flow_validation_inactivity_quantity_required')
      );
    }
    if (!Number.isInteger(inactivityAlert.time) || inactivityAlert.time < 1) {
      throw new Error(t('chatbot_flow_validation_inactivity_time_required'));
    }
  }
}
