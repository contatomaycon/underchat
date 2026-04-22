import 'reflect-metadata';

jest.mock('@core/services/randomMessage.service', () => ({
  RandomMessageService: class {},
}));

import { RandomMessageItemViewerUseCase } from '@core/useCases/randomMessage/RandomMessageItemViewer.useCase';

describe('RandomMessageItemViewerUseCase', () => {
  it('throws when random message is not found', async () => {
    const randomMessageService = {
      viewRandomMessageById: jest.fn(async () => null),
      viewRandomMessageItemById: jest.fn(),
    };
    const useCase = new RandomMessageItemViewerUseCase(
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
    };
    const useCase = new RandomMessageItemViewerUseCase(
      randomMessageService as never
    );
    const t = jest.fn((key: string) => key);

    await expect(
      useCase.execute(t as never, 'rm-1', 'rmi-1', 'acc-1')
    ).rejects.toThrow('random_message_item_not_found');
  });

  it('returns random message item by id', async () => {
    const item = { random_message_item_id: 'rmi-1' };
    const randomMessageService = {
      viewRandomMessageById: jest.fn(async () => ({
        random_message_id: 'rm-1',
      })),
      viewRandomMessageItemById: jest.fn(async () => item),
    };
    const useCase = new RandomMessageItemViewerUseCase(
      randomMessageService as never
    );

    await expect(
      useCase.execute(jest.fn() as never, 'rm-1', 'rmi-1', 'acc-1')
    ).resolves.toEqual(item);
  });
});
