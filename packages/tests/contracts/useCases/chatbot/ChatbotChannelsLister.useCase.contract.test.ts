import 'reflect-metadata';

import { EWorkerPermissions } from '@core/common/enums/EPermissions/worker';
import { ChatbotChannelsListerUseCase } from '@core/useCases/chatbot/ChatbotChannelsLister.useCase';

describe('ChatbotChannelsListerUseCase', () => {
  it('keeps the channel scope when the permission is absent', async () => {
    const chatbotService = {
      listChatbotChannels: jest.fn(async () => []),
    };
    const useCase = new ChatbotChannelsListerUseCase(chatbotService as never);
    const channels = [{ id: 'worker-1', name: 'Varejo' }];

    await useCase.execute('account-1', channels);

    expect(chatbotService.listChatbotChannels).toHaveBeenCalledWith(
      'account-1',
      channels
    );
  });

  it('requests all channels for redirect flows with the permission', async () => {
    const chatbotService = {
      listChatbotChannels: jest.fn(async () => []),
    };
    const useCase = new ChatbotChannelsListerUseCase(chatbotService as never);

    await useCase.execute('account-1', [{ id: 'worker-1', name: 'Varejo' }], [
      {
        action_name:
          EWorkerPermissions.view_all_channels_for_transfer_and_forwarding,
      },
    ] as never);

    expect(chatbotService.listChatbotChannels).toHaveBeenCalledWith(
      'account-1',
      []
    );
  });
});
