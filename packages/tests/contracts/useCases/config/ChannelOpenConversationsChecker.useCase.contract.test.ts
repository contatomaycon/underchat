import 'reflect-metadata';

jest.mock('@core/services/config.service', () => ({
  ConfigService: class {},
}));
jest.mock('@core/services/chat.service', () => ({
  ChatService: class {},
}));

import { ChannelOpenConversationsCheckerUseCase } from '@core/useCases/config/ChannelOpenConversationsChecker.useCase';

describe('ChannelOpenConversationsCheckerUseCase', () => {
  it('throws when worker balancer is not found', async () => {
    const configService = {
      viewChannelBalancer: jest.fn(async () => null),
    };
    const chatService = {
      countOpenChatsByWorkerId: jest.fn(),
    };
    const useCase = new ChannelOpenConversationsCheckerUseCase(
      configService as never,
      chatService as never
    );
    const t = jest.fn((key: string) => key);

    await expect(useCase.execute(t as never, 'worker-1')).rejects.toThrow(
      'worker_not_found'
    );
    expect(chatService.countOpenChatsByWorkerId).not.toHaveBeenCalled();
  });

  it('returns open conversations count for channel', async () => {
    const configService = {
      viewChannelBalancer: jest.fn(async () => ({ account_id: 'acc-1' })),
    };
    const chatService = {
      countOpenChatsByWorkerId: jest.fn(async () => 7),
    };
    const useCase = new ChannelOpenConversationsCheckerUseCase(
      configService as never,
      chatService as never
    );

    await expect(useCase.execute(jest.fn() as never, 'worker-1')).resolves.toBe(
      7
    );
    expect(chatService.countOpenChatsByWorkerId).toHaveBeenCalledWith(
      'acc-1',
      'worker-1'
    );
  });
});
