import 'reflect-metadata';

jest.mock('@core/services/randomMessage.service', () => ({
  RandomMessageService: class {},
}));

import { RandomMessageItemDeleterUseCase } from '@core/useCases/randomMessage/RandomMessageItemDeleter.useCase';

describe('RandomMessageItemDeleterUseCase', () => {
  it('throws when parent random message is not found', async () => {
    const randomMessageService = {
      viewRandomMessageById: jest.fn(async () => null),
      viewRandomMessageItemById: jest.fn(),
      deleteRandomMessageItemById: jest.fn(),
    };
    const useCase = new RandomMessageItemDeleterUseCase(
      randomMessageService as never
    );
    const t = jest.fn((key: string) => key);

    await expect(
      useCase.execute(t as never, 'rm-1', 'rmi-1', 'acc-1')
    ).rejects.toThrow('random_message_not_found');
    expect(
      randomMessageService.viewRandomMessageItemById
    ).not.toHaveBeenCalled();
  });

  it('throws when random message item is not found', async () => {
    const randomMessageService = {
      viewRandomMessageById: jest.fn(async () => ({
        random_message_id: 'rm-1',
      })),
      viewRandomMessageItemById: jest.fn(async () => null),
      deleteRandomMessageItemById: jest.fn(),
    };
    const useCase = new RandomMessageItemDeleterUseCase(
      randomMessageService as never
    );
    const t = jest.fn((key: string) => key);

    await expect(
      useCase.execute(t as never, 'rm-1', 'rmi-1', 'acc-1')
    ).rejects.toThrow('random_message_item_not_found');
    expect(
      randomMessageService.deleteRandomMessageItemById
    ).not.toHaveBeenCalled();
  });

  it('throws when item deletion fails', async () => {
    const randomMessageService = {
      viewRandomMessageById: jest.fn(async () => ({
        random_message_id: 'rm-1',
      })),
      viewRandomMessageItemById: jest.fn(async () => ({
        random_message_item_id: 'rmi-1',
      })),
      deleteRandomMessageItemById: jest.fn(async () => false),
    };
    const useCase = new RandomMessageItemDeleterUseCase(
      randomMessageService as never
    );
    const t = jest.fn((key: string) => key);

    await expect(
      useCase.execute(t as never, 'rm-1', 'rmi-1', 'acc-1')
    ).rejects.toThrow('random_message_item_deleter_error');
  });

  it('returns true when random message item is deleted', async () => {
    const randomMessageService = {
      viewRandomMessageById: jest.fn(async () => ({
        random_message_id: 'rm-1',
      })),
      viewRandomMessageItemById: jest.fn(async () => ({
        random_message_item_id: 'rmi-1',
      })),
      deleteRandomMessageItemById: jest.fn(async () => true),
    };
    const useCase = new RandomMessageItemDeleterUseCase(
      randomMessageService as never
    );

    await expect(
      useCase.execute(jest.fn() as never, 'rm-1', 'rmi-1', 'acc-1')
    ).resolves.toBe(true);
    expect(
      randomMessageService.deleteRandomMessageItemById
    ).toHaveBeenCalledWith('rmi-1', 'rm-1', 'acc-1');
  });
});
