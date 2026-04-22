import 'reflect-metadata';

jest.mock('@core/services/randomMessage.service', () => ({
  RandomMessageService: class {},
}));

import { RandomMessageDeleterUseCase } from '@core/useCases/randomMessage/RandomMessageDeleter.useCase';

describe('RandomMessageDeleterUseCase', () => {
  it('throws when random message is not found', async () => {
    const randomMessageService = {
      viewRandomMessageById: jest.fn(async () => null),
      deleteRandomMessageById: jest.fn(),
    };
    const useCase = new RandomMessageDeleterUseCase(
      randomMessageService as never
    );
    const t = jest.fn((key: string) => key);

    await expect(useCase.execute(t as never, 'rm-1', 'acc-1')).rejects.toThrow(
      'random_message_not_found'
    );
    expect(randomMessageService.deleteRandomMessageById).not.toHaveBeenCalled();
  });

  it('throws when random message deletion fails', async () => {
    const randomMessageService = {
      viewRandomMessageById: jest.fn(async () => ({
        random_message_id: 'rm-1',
      })),
      deleteRandomMessageById: jest.fn(async () => false),
    };
    const useCase = new RandomMessageDeleterUseCase(
      randomMessageService as never
    );
    const t = jest.fn((key: string) => key);

    await expect(useCase.execute(t as never, 'rm-1', 'acc-1')).rejects.toThrow(
      'random_message_deleter_error'
    );
  });

  it('returns true when random message is deleted', async () => {
    const randomMessageService = {
      viewRandomMessageById: jest.fn(async () => ({
        random_message_id: 'rm-1',
      })),
      deleteRandomMessageById: jest.fn(async () => true),
    };
    const useCase = new RandomMessageDeleterUseCase(
      randomMessageService as never
    );

    await expect(
      useCase.execute(jest.fn() as never, 'rm-1', 'acc-1')
    ).resolves.toBe(true);
    expect(randomMessageService.deleteRandomMessageById).toHaveBeenCalledWith(
      'rm-1',
      'acc-1'
    );
  });
});
