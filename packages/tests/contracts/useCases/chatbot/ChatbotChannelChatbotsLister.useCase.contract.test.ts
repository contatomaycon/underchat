import 'reflect-metadata';
import { ChatbotChannelChatbotsListerUseCase } from '@core/useCases/chatbot/ChatbotChannelChatbotsLister.useCase';

describe('ChatbotChannelChatbotsListerUseCase', () => {
  const t = jest.fn((key: string) => key) as never;
  const workerId = '0198c5a8-8c31-7a7a-8c26-1d8b6546b111';

  function makeUseCase() {
    const chatService = {
      viewWorkerConfigForChat: jest.fn(async () => ({
        input_chatbot: {
          chatbot_id: '0198c5a8-8c31-7a7a-8c26-1d8b6546b222',
          name: 'Entrada',
          type: 'input',
        },
        output_chatbot: {
          chatbot_id: '0198c5a8-8c31-7a7a-8c26-1d8b6546b333',
          name: 'Saída',
          type: 'output',
        },
      })),
    };
    const workerService = {
      viewWorkerNameAndId: jest.fn(async () => ({
        id: workerId,
        name: 'Canal',
      })),
    };
    return {
      useCase: new ChatbotChannelChatbotsListerUseCase(
        chatService as never,
        workerService as never
      ),
      chatService,
    };
  }

  it('returns the active input and output chatbots linked to the channel', async () => {
    const { useCase } = makeUseCase();
    await expect(useCase.execute(t, 'account-1', workerId)).resolves.toEqual([
      expect.objectContaining({ name: 'Entrada', type: 'input' }),
      expect.objectContaining({ name: 'Saída', type: 'output' }),
    ]);
  });

  it('rejects channels outside the user access scope', async () => {
    const { useCase, chatService } = makeUseCase();
    await expect(
      useCase.execute(t, 'account-1', workerId, [
        { id: 'another-channel', name: 'Outro' },
      ])
    ).rejects.toThrow('chat_access_denied');
    expect(chatService.viewWorkerConfigForChat).not.toHaveBeenCalled();
  });
});
