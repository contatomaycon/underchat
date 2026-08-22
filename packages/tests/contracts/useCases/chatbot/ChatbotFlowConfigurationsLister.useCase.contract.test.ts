import 'reflect-metadata';

jest.mock('@core/services/chatbot.service', () => ({
  ChatbotService: class {},
}));
jest.mock('@core/services/worker.service', () => ({
  WorkerService: class {},
}));
jest.mock(
  '@core/services/chatbotInactivityAlertChannelDeactivator.service',
  () => ({
    ChatbotInactivityAlertChannelDeactivatorService: class {},
  })
);

import { ChatbotFlowConfigurationsListerUseCase } from '@core/useCases/chatbot/ChatbotFlowConfigurationsLister.useCase';

describe('ChatbotFlowConfigurationsListerUseCase', () => {
  const accountId = '019b4e0d-0000-7000-8000-000000000001';
  const chatbotId = '019b4e0d-0000-7000-8000-000000000002';
  const channelId = '019b4e0d-0000-7000-8000-000000000003';

  function makeUseCase(options: { channelExists: boolean }) {
    const configuration = {
      chatbot_configurations_id: 'configuration-1',
      chatbot_id: chatbotId,
      account_id: accountId,
      configurations: {
        inactivity_alert: {
          status: 'active',
          quantity: 3,
          time: 5,
          action: 'redirect',
          redirect_type: 'chatbot' as const,
          selected_channel: channelId,
          selected_chatbot: chatbotId,
        },
        finish_triggers: ['finished'],
      },
    };
    const chatbotService = {
      findChatbotFlowConfigurationsByChatbotId: jest.fn(
        async () => configuration
      ),
    };
    const workerService = {
      viewWorkerNameAndIdConsistent: jest.fn(async () =>
        options.channelExists ? { id: channelId, name: 'Canal' } : null
      ),
    };
    const inactivityAlertChannelDeactivator = {
      deactivateByChannel: jest.fn(async () => 1),
    };

    return {
      useCase: new ChatbotFlowConfigurationsListerUseCase(
        chatbotService as never,
        workerService as never,
        inactivityAlertChannelDeactivator as never
      ),
      configuration,
      workerService,
      inactivityAlertChannelDeactivator,
    };
  }

  it('deactivates a legacy alert whose selected channel no longer exists', async () => {
    const { useCase, configuration, inactivityAlertChannelDeactivator } =
      makeUseCase({ channelExists: false });

    const result = await useCase.execute(accountId, chatbotId);

    expect(
      inactivityAlertChannelDeactivator.deactivateByChannel
    ).toHaveBeenCalledWith(accountId, channelId);
    expect(result?.configurations.inactivity_alert).toEqual({
      ...configuration.configurations.inactivity_alert,
      status: 'inactive',
    });
    expect(result?.configurations.finish_triggers).toEqual(['finished']);
  });

  it('keeps the alert active when the selected channel still exists', async () => {
    const { useCase, configuration, inactivityAlertChannelDeactivator } =
      makeUseCase({ channelExists: true });

    await expect(useCase.execute(accountId, chatbotId)).resolves.toEqual(
      configuration
    );
    expect(
      inactivityAlertChannelDeactivator.deactivateByChannel
    ).not.toHaveBeenCalled();
  });
});
