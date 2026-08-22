import { injectable, inject } from 'tsyringe';
import { ChatbotService } from '@core/services/chatbot.service';
import { ListChatbotFlowConfigurationsResponse } from '@core/schema/chatbot/listChatbotFlowConfigurations/response.schema';
import { WorkerService } from '@core/services/worker.service';
import { ChatbotInactivityAlertChannelDeactivatorService } from '@core/services/chatbotInactivityAlertChannelDeactivator.service';

@injectable()
export class ChatbotFlowConfigurationsListerUseCase {
  constructor(
    @inject(ChatbotService)
    private readonly chatbotService: ChatbotService,
    @inject(WorkerService)
    private readonly workerService: WorkerService,
    @inject(ChatbotInactivityAlertChannelDeactivatorService)
    private readonly inactivityAlertChannelDeactivator: ChatbotInactivityAlertChannelDeactivatorService
  ) {}

  async execute(
    accountId: string,
    chatbotId: string
  ): Promise<ListChatbotFlowConfigurationsResponse | null> {
    const response =
      await this.chatbotService.findChatbotFlowConfigurationsByChatbotId(
        accountId,
        chatbotId
      );
    const inactivityAlert = response?.configurations.inactivity_alert;
    const selectedChannel = inactivityAlert?.selected_channel;
    if (
      !response ||
      !inactivityAlert ||
      inactivityAlert.status !== 'active' ||
      inactivityAlert.action !== 'redirect' ||
      inactivityAlert.redirect_type !== 'chatbot' ||
      !selectedChannel
    ) {
      return response;
    }

    const channel = await this.workerService.viewWorkerNameAndIdConsistent(
      accountId,
      selectedChannel
    );
    if (channel) {
      return response;
    }

    await this.inactivityAlertChannelDeactivator.deactivateByChannel(
      accountId,
      selectedChannel
    );

    return {
      ...response,
      configurations: {
        ...response.configurations,
        inactivity_alert: {
          ...inactivityAlert,
          status: 'inactive',
        },
      },
    };
  }
}
