import 'reflect-metadata';
import { ChatbotFlowConfigurationsSaverUseCase } from '@core/useCases/chatbot/ChatbotFlowConfigurationsSaver.useCase';

describe('ChatbotFlowConfigurationsSaverUseCase inactivity chatbot target', () => {
  const t = jest.fn((key: string) => key) as never;
  const channelId = '0198c5a8-8c31-7a7a-8c26-1d8b6546b111';
  const chatbotId = '0198c5a8-8c31-7a7a-8c26-1d8b6546b222';
  const activeTiming = { quantity: 2, time: 5 } as const;

  function makeUseCase() {
    const chatbotService = {
      saveChatbotFlowConfigurations: jest.fn(async () => 'configuration-1'),
    };
    const accountService = {
      existsAccountById: jest.fn(async () => true),
    };
    const chatService = {
      viewWorkerConfigForChat: jest.fn(async () => ({
        input_chatbot: { chatbot_id: chatbotId },
        output_chatbot: null,
      })),
    };
    const workerService = {
      viewWorkerNameAndId: jest.fn(async () => ({
        id: channelId,
        name: 'Canal',
      })),
    };
    return {
      useCase: new ChatbotFlowConfigurationsSaverUseCase(
        chatbotService as never,
        accountService as never,
        chatService as never,
        workerService as never
      ),
      chatbotService,
      chatService,
      workerService,
    };
  }

  it('validates and persists only the selected chatbot destination', async () => {
    const { useCase, chatbotService } = makeUseCase();
    await expect(
      useCase.execute(
        t,
        {
          chatbot_id: chatbotId,
          configurations: {
            inactivity_alert: {
              status: 'active',
              ...activeTiming,
              action: 'redirect',
              redirect_type: 'chatbot',
              selected_channel: channelId,
              selected_chatbot: chatbotId,
              selected_user: 'hidden-user',
              selected_sector: 'hidden-sector',
            },
          },
        },
        'account-1'
      )
    ).resolves.toBe('configuration-1');

    expect(chatbotService.saveChatbotFlowConfigurations).toHaveBeenCalledWith(
      expect.objectContaining({
        configurations: expect.objectContaining({
          inactivity_alert: {
            status: 'active',
            quantity: 2,
            time: 5,
            action: 'redirect',
            redirect_type: 'chatbot',
            selected_channel: channelId,
            selected_chatbot: chatbotId,
          },
        }),
      }),
      'account-1'
    );
  });

  it.each([
    [{ selected_chatbot: chatbotId }, 'channel_required'],
    [{ selected_channel: channelId }, 'chatbot_required'],
  ])('rejects an incomplete chatbot destination', async (target, errorKey) => {
    const { useCase, chatbotService } = makeUseCase();
    await expect(
      useCase.execute(
        t,
        {
          chatbot_id: chatbotId,
          configurations: {
            inactivity_alert: {
              status: 'active',
              ...activeTiming,
              action: 'redirect',
              redirect_type: 'chatbot',
              ...target,
            },
          },
        },
        'account-1'
      )
    ).rejects.toThrow(errorKey);
    expect(chatbotService.saveChatbotFlowConfigurations).not.toHaveBeenCalled();
  });

  it('rejects an inaccessible channel before loading it', async () => {
    const { useCase, workerService } = makeUseCase();
    await expect(
      useCase.execute(
        t,
        {
          chatbot_id: chatbotId,
          configurations: {
            inactivity_alert: {
              status: 'active',
              ...activeTiming,
              action: 'redirect',
              redirect_type: 'chatbot',
              selected_channel: channelId,
              selected_chatbot: chatbotId,
            },
          },
        },
        'account-1',
        [{ id: 'another-channel', name: 'Outro' }]
      )
    ).rejects.toThrow('chat_access_denied');
    expect(workerService.viewWorkerNameAndId).not.toHaveBeenCalled();
  });

  it('rejects a chatbot that is no longer active and linked to the channel', async () => {
    const { useCase, chatService } = makeUseCase();
    chatService.viewWorkerConfigForChat.mockResolvedValueOnce({
      input_chatbot: { chatbot_id: 'another-chatbot' },
      output_chatbot: null,
    });
    await expect(
      useCase.execute(
        t,
        {
          chatbot_id: chatbotId,
          configurations: {
            inactivity_alert: {
              status: 'active',
              ...activeTiming,
              action: 'redirect',
              redirect_type: 'chatbot',
              selected_channel: channelId,
              selected_chatbot: chatbotId,
            },
          },
        },
        'account-1'
      )
    ).rejects.toThrow('chatbot_not_found');
  });

  it('keeps legacy user configurations compatible', async () => {
    const { useCase, chatbotService, chatService } = makeUseCase();
    await useCase.execute(
      t,
      {
        chatbot_id: chatbotId,
        configurations: {
          inactivity_alert: {
            status: 'active',
            ...activeTiming,
            action: 'redirect',
            redirect_type: 'user',
            selected_user: 'user-1',
          },
        },
      },
      'account-1'
    );
    expect(chatService.viewWorkerConfigForChat).not.toHaveBeenCalled();
    expect(chatbotService.saveChatbotFlowConfigurations).toHaveBeenCalled();
  });

  it('removes every redirect destination when the action is finish', async () => {
    const { useCase, chatbotService } = makeUseCase();

    await useCase.execute(
      t,
      {
        chatbot_id: chatbotId,
        configurations: {
          inactivity_alert: {
            status: 'active',
            ...activeTiming,
            action: 'finish',
            redirect_type: 'chatbot',
            selected_channel: channelId,
            selected_chatbot: chatbotId,
          },
        },
      },
      'account-1'
    );

    expect(chatbotService.saveChatbotFlowConfigurations).toHaveBeenCalledWith(
      expect.objectContaining({
        configurations: expect.objectContaining({
          inactivity_alert: {
            status: 'active',
            quantity: 2,
            time: 5,
            action: 'finish',
          },
        }),
      }),
      'account-1'
    );
  });

  it.each([
    [
      { status: 'active', time: 5 },
      'chatbot_flow_validation_inactivity_quantity_required',
    ],
    [
      { status: 'active', quantity: 2 },
      'chatbot_flow_validation_inactivity_time_required',
    ],
  ])(
    'rejects active inactivity configuration with missing timing fields',
    async (inactivityAlert, errorKey) => {
      const { useCase, chatbotService } = makeUseCase();

      await expect(
        useCase.execute(
          t,
          {
            chatbot_id: chatbotId,
            configurations: { inactivity_alert: inactivityAlert },
          } as never,
          'account-1'
        )
      ).rejects.toThrow(errorKey);
      expect(
        chatbotService.saveChatbotFlowConfigurations
      ).not.toHaveBeenCalled();
    }
  );
});
