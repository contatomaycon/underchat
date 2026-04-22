import 'reflect-metadata';

jest.mock('@core/services/randomMessage.service', () => ({
  RandomMessageService: class {},
}));

import { RandomMessageUpdaterUseCase } from '@core/useCases/randomMessage/RandomMessageUpdater.useCase';

describe('RandomMessageUpdaterUseCase', () => {
  it('throws when random message is not found', async () => {
    const randomMessageService = {
      viewRandomMessageById: jest.fn(async () => null),
      updateRandomMessageById: jest.fn(),
    };
    const useCase = new RandomMessageUpdaterUseCase(
      randomMessageService as never
    );
    const t = jest.fn((key: string) => key);

    await expect(
      useCase.execute(t as never, 'rm-1', 'acc-1', { name: 'Hello' } as never)
    ).rejects.toThrow('random_message_not_found');
    expect(randomMessageService.updateRandomMessageById).not.toHaveBeenCalled();
  });

  it('throws when random message update fails', async () => {
    const randomMessageService = {
      viewRandomMessageById: jest.fn(async () => ({
        random_message_id: 'rm-1',
      })),
      updateRandomMessageById: jest.fn(async () => false),
    };
    const useCase = new RandomMessageUpdaterUseCase(
      randomMessageService as never
    );
    const t = jest.fn((key: string) => key);

    await expect(
      useCase.execute(t as never, 'rm-1', 'acc-1', { name: 'Hello' } as never)
    ).rejects.toThrow('random_message_update_error');
  });

  it('updates random message and returns true', async () => {
    const input = { name: 'Hello', status: 'active' } as never;
    const randomMessageService = {
      viewRandomMessageById: jest.fn(async () => ({
        random_message_id: 'rm-1',
      })),
      updateRandomMessageById: jest.fn(async () => true),
    };
    const useCase = new RandomMessageUpdaterUseCase(
      randomMessageService as never
    );

    await expect(
      useCase.execute(jest.fn() as never, 'rm-1', 'acc-1', input)
    ).resolves.toBe(true);
    expect(randomMessageService.updateRandomMessageById).toHaveBeenCalledWith({
      random_message_id: 'rm-1',
      account_id: 'acc-1',
      name: 'Hello',
      status: 'active',
    });
  });
});
